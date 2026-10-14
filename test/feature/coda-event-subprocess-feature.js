import { Definition } from 'bpmn-elements';
import testHelpers from '../helpers/testHelpers.js';

// Coda's fork: event sub-processes started by events that come from outside the process (a message or a signal sent
// to the definition) or by a timer, interrupting or not, in the process or in a sub-process; and non-interrupting
// boundary events that keep listening while their activity goes on.
const definitionSource = (body, top = '') => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="defs" targetNamespace="http://bpmn.io/schema/bpmn">
  ${top}
  <process id="process" isExecutable="true">${body}</process>
</definitions>`;

const waiting = `<startEvent id="start" /><sequenceFlow id="to-task" sourceRef="start" targetRef="task" />
  <userTask id="task" /><sequenceFlow id="to-end" sourceRef="task" targetRef="end" /><endEvent id="end" />`;

const onMessage = (interrupting) => `<subProcess id="on-message" triggeredByEvent="true">
    <startEvent id="message-start" isInterrupting="${interrupting}"><messageEventDefinition messageRef="Message" /></startEvent>
    <sequenceFlow id="to-handle" sourceRef="message-start" targetRef="handle" /><task id="handle" />
    <sequenceFlow id="to-handled" sourceRef="handle" targetRef="handled" /><endEvent id="handled" />
  </subProcess>`;

// How many times each element ended, and left (ended or not), wherever it is, sub-processes included.
async function prepare(source) {
  const context = await testHelpers.context(source);
  const definition = new Definition(context);
  const ended = {},
    left = {};
  const count = (into) => (_, message) => {
    into[message.content.id] = (into[message.content.id] ?? 0) + 1;
  };
  definition.broker.subscribeTmp('event', 'activity.end', count(ended), { noAck: true });
  definition.broker.subscribeTmp('event', 'activity.leave', count(left), { noAck: true });
  return Object.assign(definition, { ended, left });
}

Feature('Event sub-processes triggered from outside the process', () => {
  Scenario('a non-interrupting event sub-process started by a message sent to the definition, twice', () => {
    let definition;
    Given('a process waiting at a user task, with a non-interrupting message event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onMessage(false), '<message id="Message" name="push" />'));
    });

    When('ran', () => {
      definition.run();
    });

    Then('it waits at the user task', () => {
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });

    When('the message is sent to the definition', () => {
      definition.sendMessage({ id: 'Message', head: 'abc' });
    });

    Then('the event sub-process ran, and the user task still waits', () => {
      expect(definition.getActivityById('on-message').counters).to.deep.equal({ taken: 1, discarded: 0 });
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });

    When('the message is sent again', () => {
      definition.sendMessage({ id: 'Message', head: 'def' });
    });

    Then('the event sub-process ran again', () => {
      expect(definition.getActivityById('on-message').counters).to.deep.equal({ taken: 2, discarded: 0 });
      expect(definition.ended.handle).to.equal(2);
    });

    let end;
    When('the user task is completed', () => {
      end = definition.waitFor('leave');
      definition.getPostponed()[0].signal();
    });

    Then('the run completes', async () => {
      await end;
      expect(definition.getActivityById('end').counters.taken).to.equal(1);
    });
  });

  Scenario('an interrupting event sub-process started by a message sent to the definition', () => {
    let definition;
    Given('a process waiting at a user task, with an interrupting message event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onMessage(true), '<message id="Message" name="close" />'));
    });

    let end;
    When('ran, and the message is sent', () => {
      end = definition.waitFor('leave');
      definition.run();
      definition.sendMessage({ id: 'Message' });
    });

    Then('the user task is discarded and the run completes through the event sub-process', async () => {
      await end;
      expect([definition.ended.task, definition.left.task]).to.deep.equal([undefined, 1]);
      expect(definition.ended.handled).to.equal(1);
      expect(definition.ended.end).to.be.undefined;
    });
  });

  Scenario('a message event sub-process started by the api signal naming the message, as it is sent to what waits for it', () => {
    let definition;
    Given('a process waiting at a user task, with a non-interrupting message event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onMessage(false), '<message id="Message" name="push" />'));
    });

    When('ran, and the definition is signalled with the message', () => {
      definition.run();
      definition.signal({ id: 'Message', head: 'abc' });
    });

    Then('the event sub-process ran, and the user task still waits', () => {
      expect(definition.ended['message-start']).to.equal(1);
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });
  });

  Scenario('an event sub-process started by a signal sent to the definition', () => {
    let definition;
    Given('a process waiting at a user task, with a non-interrupting signal event sub-process', async () => {
      definition = await prepare(
        definitionSource(
          waiting +
            `<subProcess id="on-signal" triggeredByEvent="true">
              <startEvent id="signal-start" isInterrupting="false"><signalEventDefinition signalRef="Signal" /></startEvent>
              <sequenceFlow id="to-signalled" sourceRef="signal-start" targetRef="signalled" /><endEvent id="signalled" />
            </subProcess>`,
          '<signal id="Signal" name="go" />'
        )
      );
    });

    When('ran, and the signal is sent', () => {
      definition.run();
      definition.signal({ id: 'Signal' });
    });

    Then('the event sub-process ran, and the user task still waits', () => {
      expect(definition.getActivityById('on-signal').counters).to.deep.equal({ taken: 1, discarded: 0 });
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });
  });

  Scenario('a message something waits for goes to it; one nothing waits for starts the event sub-process', () => {
    let definition;
    Given('an event sub-process for a message, declared before a task with a message boundary event for it', async () => {
      definition = await prepare(
        definitionSource(
          onMessage(false) +
            waiting.replace('targetRef="end"', 'targetRef="after"') +
            `<userTask id="after" /><sequenceFlow id="after-to-end" sourceRef="after" targetRef="end" />
            <boundaryEvent id="bound" attachedToRef="task" cancelActivity="false"><messageEventDefinition messageRef="Message" /></boundaryEvent>
            <sequenceFlow id="to-bound-end" sourceRef="bound" targetRef="bound-end" /><endEvent id="bound-end" />`,
          '<message id="Message" name="poke" />'
        )
      );
    });

    When('ran, and the message is sent', () => {
      definition.run();
      definition.sendMessage({ id: 'Message' });
    });

    Then('the boundary event waiting for it took it, and the event sub-process did not start', () => {
      expect(definition.ended.bound).to.equal(1);
      expect(definition.getActivityById('on-message').counters).to.deep.equal({ taken: 0, discarded: 0 });
      expect(definition.getPostponed().map((api) => api.id)).to.have.members(['task', 'bound']);
    });

    When('the user task is completed, so that the process waits at the next one only, and the message is sent again', () => {
      definition
        .getPostponed()
        .find((api) => api.id === 'task')
        .signal();
      definition.sendMessage({ id: 'Message' });
    });

    Then('the event sub-process took it', () => {
      expect(definition.ended.bound).to.equal(1);
      expect(definition.ended['message-start']).to.equal(1);
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['after']);
    });
  });

  Scenario('an interrupting event sub-process inside a sub-process interrupts that sub-process only', () => {
    let definition;
    Given('a sub-process waiting at a user task, with an interrupting message event sub-process inside it', async () => {
      definition = await prepare(
        definitionSource(
          `<startEvent id="start" /><sequenceFlow id="to-sub" sourceRef="start" targetRef="sub" />
          <subProcess id="sub">${waiting
            .replace(/"start"/g, '"sub-start"')
            .replace(/"end"/g, '"sub-end"')
            .replace(/to-/g, 'sub-to-')}${onMessage(true)}</subProcess>
          <sequenceFlow id="to-after" sourceRef="sub" targetRef="after" /><task id="after" /><sequenceFlow id="to-end" sourceRef="after" targetRef="end" /><endEvent id="end" />`,
          '<message id="Message" name="close" />'
        )
      );
    });

    let end;
    When('ran, and the message is sent', () => {
      end = definition.waitFor('leave');
      definition.run();
      definition.sendMessage({ id: 'Message' });
    });

    Then('the sub-process is done through its event sub-process, and the process goes on after it', async () => {
      await end;
      expect([definition.ended.task, definition.left.task]).to.deep.equal([undefined, 1]);
      expect(definition.ended.handled).to.equal(1);
      expect(definition.ended.after).to.equal(1);
    });
  });
});

Feature('Event sub-processes started by a timer', () => {
  const onTimer = (interrupting) => `<subProcess id="on-timer" triggeredByEvent="true">
      <startEvent id="timer-start" isInterrupting="${interrupting}"><timerEventDefinition><timeDuration xsi:type="tFormalExpression">PT1S</timeDuration></timerEventDefinition></startEvent>
      <sequenceFlow id="to-remind" sourceRef="timer-start" targetRef="remind" /><task id="remind" />
      <sequenceFlow id="to-reminded" sourceRef="remind" targetRef="reminded" /><endEvent id="reminded" />
    </subProcess>`;

  Scenario('a non-interrupting timer event sub-process: armed as the process starts, it does not hold the process up', () => {
    let definition;
    Given('a process waiting at a user task, with a non-interrupting timer event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onTimer(false)));
    });

    When('ran', () => {
      definition.run();
    });

    Then('its timer is armed', () => {
      expect(definition.environment.timers.executing).to.have.length(1);
    });

    When('the timer goes off', () => {
      definition.environment.timers.executing[0].callback();
    });

    Then('the event sub-process ran, and the user task still waits', () => {
      expect(definition.ended.reminded).to.equal(1);
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });

    let end;
    When('the user task is completed', () => {
      end = definition.waitFor('leave');
      definition.getPostponed()[0].signal();
    });

    Then('the run completes', async () => {
      await end;
      expect(definition.getActivityById('end').counters.taken).to.equal(1);
    });
  });

  Scenario('a timer event sub-process that never goes off does not hold the process up', () => {
    let definition;
    Given('a process waiting at a user task, with a timer event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onTimer(false)));
    });

    let end;
    When('ran, and the user task is completed before the timer', () => {
      end = definition.waitFor('leave');
      definition.run();
      definition
        .getPostponed()
        .find((api) => api.id === 'task')
        .signal();
    });

    Then('the run completes, the timer let go', async () => {
      await end;
      expect(definition.environment.timers.executing).to.have.length(0);
      expect(definition.ended.reminded).to.be.undefined;
    });
  });

  Scenario('an interrupting timer event sub-process discards what the process was doing', () => {
    let definition;
    Given('a process waiting at a user task, with an interrupting timer event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onTimer(true)));
    });

    let end;
    When('ran, and the timer goes off', () => {
      end = definition.waitFor('leave');
      definition.run();
      definition.environment.timers.executing[0].callback();
    });

    Then('the user task is discarded and the run completes through the event sub-process', async () => {
      await end;
      expect([definition.ended.task, definition.left.task]).to.deep.equal([undefined, 1]);
      expect(definition.ended.reminded).to.equal(1);
    });
  });

  Scenario('an armed timer event sub-process survives a stop and resume', () => {
    let definition;
    Given('a process waiting at a user task, with a non-interrupting timer event sub-process', async () => {
      definition = await prepare(definitionSource(waiting + onTimer(false)));
      definition.run();
    });

    let state;
    When('stopped and recovered', async () => {
      definition.stop();
      state = definition.getState();
      definition = await prepare(definitionSource(waiting + onTimer(false)));
      definition.recover(JSON.parse(JSON.stringify(state)));
      definition.resume();
    });

    Then('its timer is armed again', () => {
      expect(definition.environment.timers.executing).to.have.length(1);
    });

    When('the timer goes off', () => {
      definition.environment.timers.executing[0].callback();
    });

    Then('the event sub-process ran', () => {
      expect(definition.ended.reminded).to.equal(1);
    });
  });
});

Feature('Non-interrupting boundary events keep listening', () => {
  Scenario('a non-interrupting message boundary event takes each message while its activity waits', () => {
    let definition;
    Given('a user task with a non-interrupting message boundary event', async () => {
      definition = await prepare(
        definitionSource(
          waiting +
            `<boundaryEvent id="nudge" attachedToRef="task" cancelActivity="false"><messageEventDefinition messageRef="Message" /></boundaryEvent>
            <sequenceFlow id="to-nudged" sourceRef="nudge" targetRef="nudged" /><endEvent id="nudged" />`,
          '<message id="Message" name="push" />'
        )
      );
    });

    When('ran, and the message is sent three times', () => {
      definition.run();
      for (let i = 0; i < 3; i++) definition.sendMessage({ id: 'Message', n: i });
    });

    Then('each was taken, and the user task still waits', () => {
      expect(definition.getActivityById('nudged').counters.taken).to.equal(3);
      expect(definition.getPostponed().map((api) => api.id)).to.include('task');
    });

    let end;
    When('the user task is completed', () => {
      end = definition.waitFor('leave');
      definition
        .getPostponed()
        .find((api) => api.id === 'task')
        .signal();
    });

    Then('the run completes, the boundary event let go', async () => {
      await end;
      expect(definition.getActivityById('end').counters.taken).to.equal(1);
      expect(definition.getActivityById('nudge').counters.taken).to.equal(3);
    });
  });

  Scenario('a non-interrupting timer boundary event with a duration still goes off once', () => {
    let definition;
    Given('a user task with a non-interrupting duration timer', async () => {
      definition = await prepare(
        definitionSource(
          waiting +
            `<boundaryEvent id="remind" attachedToRef="task" cancelActivity="false"><timerEventDefinition><timeDuration xsi:type="tFormalExpression">PT1S</timeDuration></timerEventDefinition></boundaryEvent>
            <sequenceFlow id="to-reminded" sourceRef="remind" targetRef="reminded" /><endEvent id="reminded" />`
        )
      );
    });

    When('ran, and the timer goes off', () => {
      definition.run();
      definition.environment.timers.executing[0].callback();
    });

    Then('it went off once, and no timer is left', () => {
      expect(definition.getActivityById('reminded').counters.taken).to.equal(1);
      expect(definition.environment.timers.executing).to.have.length(0);
    });
  });

  Scenario('a non-interrupting conditional boundary event is met once', () => {
    let definition;
    Given('a user task with a non-interrupting conditional boundary event', async () => {
      definition = await prepare(
        definitionSource(
          waiting +
            `<boundaryEvent id="bound" attachedToRef="task" cancelActivity="false">
              <conditionalEventDefinition><condition xsi:type="tFormalExpression">\${environment.variables.go}</condition></conditionalEventDefinition>
            </boundaryEvent>
            <sequenceFlow id="to-bound-end" sourceRef="bound" targetRef="bound-end" /><endEvent id="bound-end" />`
        )
      );
    });

    When('ran, the condition comes to hold and the boundary event is told to check it', () => {
      definition.run();
      definition.getProcesses()[0].environment.variables.go = true;
      definition
        .getPostponed()
        .find((api) => api.id === 'bound')
        .signal();
    });

    Then('it is met once, and the user task still waits', () => {
      expect(definition.ended.bound).to.equal(1);
      expect(definition.getPostponed().map((api) => api.id)).to.deep.equal(['task']);
    });
  });
});

Feature('Event sub-processes catching what an activity failed with', () => {
  const failing = (onError) =>
    definitionSource(
      `<startEvent id="start" /><sequenceFlow id="to-fork" sourceRef="start" targetRef="fork" /><parallelGateway id="fork" />
      <sequenceFlow id="to-step" sourceRef="fork" targetRef="step" /><serviceTask id="step" implementation="\${environment.services.fail}" />
      <sequenceFlow id="to-end" sourceRef="step" targetRef="end" /><endEvent id="end" />
      <sequenceFlow id="to-task" sourceRef="fork" targetRef="task" /><userTask id="task" />
      <boundaryEvent id="task-error" attachedToRef="task"><errorEventDefinition /></boundaryEvent>
      <sequenceFlow id="to-task-end" sourceRef="task" targetRef="task-end" /><endEvent id="task-end" />
      <sequenceFlow id="from-task-error" sourceRef="task-error" targetRef="task-error-end" /><endEvent id="task-error-end" />
      ${onError}`,
      '<error id="Failed" errorCode="STEP_FAILED" /><error id="Other" errorCode="OTHER" />'
    );
  const onError = (id, ref) => `<subProcess id="${id}" triggeredByEvent="true">
      <startEvent id="${id}-start"><errorEventDefinition ${ref ? `errorRef="${ref}"` : ''} /></startEvent>
      <sequenceFlow id="${id}-to-end" sourceRef="${id}-start" targetRef="${id}-end" /><endEvent id="${id}-end" />
    </subProcess>`;
  const run = async (source) => {
    const context = await testHelpers.context(source);
    const definition = new Definition(context, {
      services: {
        fail(_context, next) {
          next(Object.assign(new Error('step failed'), { code: 'STEP_FAILED' }));
        },
      },
    });
    const ended = {};
    definition.broker.subscribeTmp(
      'event',
      'activity.end',
      (_, message) => {
        ended[message.content.id] = (ended[message.content.id] ?? 0) + 1;
      },
      { noAck: true }
    );
    const settled = new Promise((resolve) => {
      definition.on('leave', () => resolve('completed'));
      definition.on('error', () => resolve('failed'));
    });
    definition.run();
    return { definition, ended, settled };
  };

  Scenario('the event sub-process for its error code takes a failed activity, ending the rest of the scope', () => {
    let result;
    When('a step fails beside a waiting task with its own error boundary event', async () => {
      result = await run(failing(onError('on-any') + onError('on-other', 'Other') + onError('on-failed', 'Failed')));
    });

    Then('the run completes through the event sub-process for that code, and the task is ended, not caught', async () => {
      expect(await result.settled).to.equal('completed');
      expect(result.ended['on-failed-end']).to.equal(1);
      expect([result.ended['on-any-end'], result.ended['on-other-end'], result.ended['task-error'], result.ended.task]).to.deep.equal([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });
  });

  Scenario('with none for its code, the one for any error takes it; with none at all, the run fails', () => {
    let any, none;
    When('a step fails, once with an event sub-process for any error, once with one for another code only', async () => {
      any = await run(failing(onError('on-any') + onError('on-other', 'Other')));
      none = await run(failing(onError('on-other', 'Other')));
    });

    Then('the first completes through the one for any error, the second fails', async () => {
      expect(await any.settled).to.equal('completed');
      expect(any.ended['on-any-end']).to.equal(1);
      expect(await none.settled).to.equal('failed');
    });
  });
});
