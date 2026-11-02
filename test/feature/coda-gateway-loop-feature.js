import { readFileSync } from 'node:fs';
import { Definition, Timers } from 'bpmn-elements';
import testHelpers from '../helpers/testHelpers.js';

const source = readFileSync(new URL('../resources/coda-watch.bpmn', import.meta.url), 'utf8');
// Captured with 18.1.0-coda.7 (b10b361): recover an expired timer before its message peer resumes.
// One snapshot waits at look with the old listener; the other has reentered the gateway and queued its next listener.
const snapshots = Object.fromEntries(
  ['orphan', 'queued'].map((stage) => [
    stage,
    JSON.parse(readFileSync(new URL(`../resources/coda-watch-${stage}.json`, import.meta.url), 'utf8')),
  ])
);

function expire(definition) {
  const [timer] = definition.environment.timers.executing;
  expect(timer).to.be.ok;
  timer.callback(...timer.args);
}

function finish(definition) {
  let ended = false;
  definition.once('end', () => {
    ended = true;
  });
  definition.getProcesses()[0].environment.variables.archived = true;
  definition.signal({ id: 'look' });
  expect(definition.getActivityById('done').counters.taken).to.equal(1);
  expect(definition.getPostponed().map((api) => api.id)).to.deep.equal([]);
  expect(ended, 'the definition ended, not just its end event').to.equal(true);
}

describe('Coda: event gateway loop', () => {
  for (const stage of ['orphan', 'queued'])
    for (const winner of ['timer', 'message', 'expired', 'saved-expired']) {
      it(`ends after recovering ${stage} state from coda.7 and ${winner} wins`, async () => {
        const context = await testHelpers.context(source, { timers: new Timers({ setTimeout: () => 0, clearTimeout() {} }) });
        let definition = new Definition(context);
        // The checkpoint's absolute deadline is irrelevant: expiry is controlled below.
        const state = JSON.parse(JSON.stringify(snapshots[stage]).replace(/"expireAt":"[^"]+"/g, '"expireAt":"9999-01-01T00:00:00.000Z"'));
        definition.recover(state).resume();
        if (stage === 'orphan') definition.signal({ id: 'look' });
        if (winner.endsWith('expired')) {
          const due = JSON.parse(
            JSON.stringify(definition.getState()).replace(/"expireAt":"[^"]+"/g, '"expireAt":"1970-01-01T00:00:00.000Z"')
          );
          definition.stop();
          definition = new Definition(context.clone()).recover(due);
          let midway;
          definition.broker.subscribeTmp(
            'event',
            'activity.end',
            (_, message) => {
              if (message.content.id === 'waiting') midway = JSON.parse(JSON.stringify(definition.getState()));
            },
            { noAck: true }
          );
          definition.resume();
          if (winner === 'saved-expired') {
            expect(midway).to.be.ok;
            definition.stop();
            definition = new Definition(context.clone()).recover(midway);
            definition.resume();
          }
        } else if (winner === 'timer') expire(definition);
        else definition.signal({ id: 'reported', type: 'message' });
        finish(definition);
      });
    }

  for (const poll of ['PT1H', '1970-01-01T00:00:00.000Z']) {
    it(`ends a new message-started run when its ${poll} expression timer wins`, async () => {
      const xml = poll === 'PT1H' ? source : source.replace(/timeDuration/g, 'timeDate');
      const context = await testHelpers.context(xml, {
        variables: { archived: false, poll },
        timers: new Timers({ setTimeout: () => 0, clearTimeout() {} }),
      });
      const definition = new Definition(context);
      definition.run();
      definition.signal({ id: 'reported', type: 'message' });
      definition.signal({ id: 'look' });
      if (poll === 'PT1H') expire(definition);
      finish(definition);
    });
  }
});

describe('Coda: gateway ownership of inbound activations', () => {
  it('keeps a closed race without broker state and recovers it', async () => {
    const context = await testHelpers.context(source, { settings: { disableTrackState: true } });
    const activity = context.getActivityById('again');
    activity.setInboundGateway('waiting', null);
    const state = activity.getState();
    expect(state.inboundGateways).to.deep.equal({ waiting: null });
    const recovered = context.clone().getActivityById('again').recover(state);
    expect(recovered.getState().inboundGateways).to.deep.equal({ waiting: null });
  });

  it('discards old race tokens, rearms the next round and preserves other sources', async () => {
    const context = await testHelpers.context(source);
    const activity = context.getActivityById('again');
    const incoming = (sourceId, evaluationId) =>
      activity.broker
        .getQueue('inbound-q')
        .queueMessage({ routingKey: 'flow.take' }, { id: 'to-again', sourceId, evaluationId, isSequenceFlow: true });
    activity.setInboundGateway('waiting', null);
    activity.activate();
    incoming('waiting', 'first');
    expect(activity.status).to.be.undefined;
    expect(activity.counters.discarded).to.equal(1);
    activity.setInboundGateway('waiting', 'second');
    incoming('waiting', 'first');
    expect(activity.status).to.be.undefined;
    expect(activity.counters.discarded).to.equal(2);
    incoming('waiting', 'second');
    expect(activity.status).to.equal('executing');
    activity.discard();
    activity.setInboundGateway('waiting', null);
    incoming('other', 'other-round');
    expect(activity.status).to.equal('executing');
    activity.discard();
  });
});
