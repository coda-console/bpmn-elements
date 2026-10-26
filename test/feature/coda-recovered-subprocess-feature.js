import { Definition } from 'bpmn-elements';
import testHelpers from '../helpers/testHelpers.js';

// Coda's fork: a sub-process recovered while something waits inside is interrupted as one never recovered is, what
// waits inside discarded with it.
const source = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <message id="Message" name="push" />
  <process id="process" isExecutable="true">
    <startEvent id="start" /><sequenceFlow id="to-sub" sourceRef="start" targetRef="sub" />
    <subProcess id="sub">
      <startEvent id="sub-start" /><sequenceFlow id="to-task" sourceRef="sub-start" targetRef="task" />
      <userTask id="task" /><sequenceFlow id="to-sub-end" sourceRef="task" targetRef="sub-end" /><endEvent id="sub-end" />
    </subProcess>
    <boundaryEvent id="pushed" attachedToRef="sub"><messageEventDefinition messageRef="Message" /></boundaryEvent>
    <sequenceFlow id="to-next" sourceRef="pushed" targetRef="next" /><userTask id="next" />
    <sequenceFlow id="to-end" sourceRef="next" targetRef="end" /><sequenceFlow id="sub-to-end" sourceRef="sub" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>`;

// How many times each element ended, and left (ended or not), wherever it is, sub-processes included.
async function prepare() {
  const definition = new Definition(await testHelpers.context(source));
  const ended = {},
    left = {};
  const count = (into) => (_, message) => {
    into[message.content.id] = (into[message.content.id] ?? 0) + 1;
  };
  definition.broker.subscribeTmp('event', 'activity.end', count(ended), { noAck: true });
  definition.broker.subscribeTmp('event', 'activity.leave', count(left), { noAck: true });
  return Object.assign(definition, { ended, left });
}

// What waits, sub-processes included.
const waiting = (definition) => {
  const ids = [],
    seen = new Set();
  const visit = (apis) => {
    for (const api of apis) {
      if (seen.has(api.executionId)) continue;
      seen.add(api.executionId);
      ids.push(api.id);
      if (api.content.isSubProcess) visit(api.getPostponed());
    }
  };
  visit(definition.getPostponed());
  return ids.sort();
};

Feature('A recovered sub-process interrupted by a boundary event', () => {
  Scenario('a user task waiting in a sub-process, the run recovered, a message boundary event takes the sub-process', () => {
    let definition;
    Given('a run waiting at the user task inside the sub-process', async () => {
      definition = await prepare();
      definition.run();
      expect(waiting(definition)).to.deep.equal(['pushed', 'sub', 'task']);
    });

    When('its state, as it was while waiting, is recovered and resumed', async () => {
      const state = JSON.parse(JSON.stringify(definition.getState()));
      definition.stop();
      definition = await prepare();
      definition.recover(state);
      definition.resume();
    });

    Then('it waits there again', () => {
      expect(waiting(definition)).to.deep.equal(['pushed', 'sub', 'task']);
    });

    When('the message comes', () => {
      definition.sendMessage({ id: 'Message' });
    });

    Then('the user task inside is discarded with the sub-process, and the run waits at the next task only', () => {
      expect([definition.ended.task, definition.left.task, definition.left.sub]).to.deep.equal([undefined, 1, 1]);
      expect(waiting(definition)).to.deep.equal(['next']);
    });
  });
});
