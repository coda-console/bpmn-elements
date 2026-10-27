import { Definition } from 'bpmn-elements';
import testHelpers from '../helpers/testHelpers.js';

// Coda's fork: an activity discarded after it was recovered and before it resumed is discarded as it resumes, not resumed
// waiting. An event based gateway does so to its other targets when one of them, a timer past due, ends it as the run
// resumes.
const source = `
<definitions id="EventBasedGateway" xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <message id="Message_1" name="Continue Message" />
  <process id="Process_0" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="to-gateway" sourceRef="start" targetRef="gateway" />
    <eventBasedGateway id="gateway" />
    <sequenceFlow id="to-timerEvent" sourceRef="gateway" targetRef="timerEvent" />
    <sequenceFlow id="to-messageEvent" sourceRef="gateway" targetRef="messageEvent" />
    <intermediateCatchEvent id="timerEvent">
      <timerEventDefinition>
        <timeDuration xsi:type="tFormalExpression">PT1M</timeDuration>
      </timerEventDefinition>
    </intermediateCatchEvent>
    <intermediateCatchEvent id="messageEvent">
      <messageEventDefinition messageRef="Message_1" />
    </intermediateCatchEvent>
    <sequenceFlow id="timer-to-end" sourceRef="timerEvent" targetRef="end" />
    <sequenceFlow id="message-to-end" sourceRef="messageEvent" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>`;

// The same with a receive task: a message event's own state saved as it waits again does not recover, discard or not.
const receiveSource = source
  .replace('<intermediateCatchEvent id="messageEvent">', '<receiveTask id="messageEvent" messageRef="Message_1">')
  .replace('<messageEventDefinition messageRef="Message_1" />\n    </intermediateCatchEvent>', '</receiveTask>');

Feature('Coda: recovered event based gateway', () => {
  Scenario('recovered gateway whose timer was due while the run was stopped', () => {
    let context, definition;
    Given('a definition with a gateway waiting on a timer and a message', async () => {
      context = await testHelpers.context(source);
      definition = new Definition(context);
    });

    let state;
    When('ran until the gateway waits, and stopped with its state saved', async () => {
      const wait = definition.waitFor('wait');
      definition.run();
      await wait;
      state = definition.getState();
      definition.stop();
    });

    let end;
    When('recovered and resumed once the timer is past due', () => {
      const due = new Date(Date.now() - 60000).toISOString();
      const saved = JSON.stringify(state);
      expect(saved.match(/"expireAt":"[^"]+"/g)).to.have.length(1);
      definition = new Definition(context.clone());
      end = definition.waitFor('leave');
      definition.recover(JSON.parse(saved.replace(/"expireAt":"[^"]+"/, `"expireAt":"${due}"`)));
      definition.resume();
    });

    Then('the timer ends the run', () => {
      return end;
    });

    And('the message event was discarded, nothing is left waiting', () => {
      expect(definition.getPostponed()).to.have.length(0);
      expect(definition.getActivityById('messageEvent').counters).to.deep.include({ taken: 0, discarded: 1 });
    });
  });

  Scenario('saved again as it resumes, before the discarded message event has resumed', () => {
    let context, definition;
    Given('a definition with a gateway waiting on a timer and a message', async () => {
      context = await testHelpers.context(source);
      definition = new Definition(context);
    });

    let state;
    When('ran until the gateway waits, and stopped with its state saved', async () => {
      const wait = definition.waitFor('wait');
      definition.run();
      await wait;
      state = definition.getState();
      definition.stop();
    });

    let midway;
    When('recovered once the timer is past due, its state saved as the gateway ends', () => {
      const due = new Date(Date.now() - 60000).toISOString();
      const saved = JSON.stringify(state).replace(/"expireAt":"[^"]+"/, `"expireAt":"${due}"`);
      definition = new Definition(context.clone());
      definition.broker.subscribeTmp(
        'event',
        'activity.end',
        (_, message) => {
          if (message.content.id === 'gateway') midway = JSON.parse(JSON.stringify(definition.getState()));
        },
        { noAck: true }
      );
      definition.recover(JSON.parse(saved));
      definition.resume();
      definition.stop();
      expect(midway, 'saved as the gateway ended').to.be.ok;
    });

    let end;
    When('recovered again from that state and resumed', () => {
      definition = new Definition(context.clone());
      end = definition.waitFor('leave');
      definition.recover(midway);
      definition.resume();
    });

    Then('the run ends', () => {
      return end;
    });

    And('the message event was discarded, nothing is left waiting', () => {
      expect(definition.getPostponed()).to.have.length(0);
      expect(definition.getActivityById('messageEvent').counters).to.deep.include({ taken: 0, discarded: 1 });
    });
  });

  Scenario('saved again as the discarded receive task resumes waiting', () => {
    let context, definition;
    Given('a definition with a gateway waiting on a timer and a receive task', async () => {
      context = await testHelpers.context(receiveSource);
      definition = new Definition(context);
    });

    let state;
    When('ran until the gateway waits, and stopped with its state saved', async () => {
      const wait = definition.waitFor('wait');
      definition.run();
      await wait;
      state = definition.getState();
      definition.stop();
    });

    let midway;
    When('recovered once the timer is past due, its state saved as the receive task waits again', () => {
      const due = new Date(Date.now() - 60000).toISOString();
      const saved = JSON.stringify(state).replace(/"expireAt":"[^"]+"/, `"expireAt":"${due}"`);
      definition = new Definition(context.clone());
      definition.broker.subscribeTmp(
        'event',
        'activity.wait',
        (_, message) => {
          if (message.content.id === 'messageEvent' && !midway) midway = JSON.parse(JSON.stringify(definition.getState()));
        },
        { noAck: true }
      );
      definition.recover(JSON.parse(saved));
      definition.resume();
      definition.stop();
      expect(midway, 'saved as the receive task waited').to.be.ok;
    });

    let end;
    When('recovered again from that state and resumed', () => {
      definition = new Definition(context.clone());
      end = definition.waitFor('leave');
      definition.recover(midway);
      definition.resume();
    });

    Then('the run ends', () => {
      return end;
    });

    And('the receive task was discarded, nothing is left waiting', () => {
      expect(definition.getPostponed()).to.have.length(0);
      expect(definition.getActivityById('messageEvent').counters).to.deep.include({ taken: 0, discarded: 1 });
    });
  });

  Scenario('the discarded message event resumes through an asynchronous format', () => {
    let context, definition;
    Given('a definition with a gateway waiting on a timer and a message', async () => {
      context = await testHelpers.context(source);
      definition = new Definition(context);
    });

    let state;
    When('ran until the gateway waits, and stopped with its state saved', async () => {
      const wait = definition.waitFor('wait');
      definition.run();
      await wait;
      state = definition.getState();
      definition.stop();
    });

    let end, messageEvent;
    When('recovered once the timer is past due, the message event formatting before it executes', () => {
      const due = new Date(Date.now() - 60000).toISOString();
      const saved = JSON.stringify(state).replace(/"expireAt":"[^"]+"/, `"expireAt":"${due}"`);
      definition = new Definition(context.clone());
      end = definition.waitFor('leave');
      definition.recover(JSON.parse(saved));
      messageEvent = definition.getActivityById('messageEvent');
      messageEvent.broker.publish('format', 'run.coda.format', { endRoutingKey: 'run.coda.formatted' });
      definition.resume();
    });

    Then('the message event is still formatting', () => {
      expect(messageEvent.status).to.equal('formatting');
    });

    When('its format ends', () => {
      messageEvent.broker.publish('format', 'run.coda.formatted', {});
    });

    Then('the run ends', () => {
      return end;
    });

    And('the message event was discarded, nothing is left waiting', () => {
      expect(definition.getPostponed()).to.have.length(0);
      expect(definition.getActivityById('messageEvent').counters).to.deep.include({ taken: 0, discarded: 1 });
    });
  });
});
