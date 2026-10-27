# bpmn-elements

[![Build](https://github.com/paed01/bpmn-elements/actions/workflows/build.yaml/badge.svg)](https://github.com/paed01/bpmn-elements/actions/workflows/build.yaml)[![Coverage Status](https://coveralls.io/repos/github/paed01/bpmn-elements/badge.svg?branch=master)](https://coveralls.io/github/paed01/bpmn-elements?branch=master)

Isomorphic JavaScript BPMN 2.0 workflow elements suitable for bundling into frontend script or just required into your nodejs project.

> **Coda fork.** Branch `coda` is maintained by Coda on top of v18.1.0 and installed from Git (pinned by commit, `dist/` checked in, no build on install). It adds:
>
> - event sub-processes started by a message or signal sent to the definition from outside, not only by events thrown inside the process (sent from outside, by the element it names, whatever the api message's type);
> - event sub-processes started by a timer (armed when their scope starts; an armed one does not hold up its scope's completion);
> - interrupting event sub-processes end the rest of their scope;
> - an error an activity fails with that no boundary event caught starts an error event sub-process for its code (or one for any error), which ends the rest of the scope;
> - an external message goes to what waits for it first; only one nothing took starts an event sub-process waiting for it;
> - non-interrupting message, signal and escalation boundary events keep listening after they fire, until their activity ends (a timer repeats by its cycle, a condition is met once);
> - a sub-process recovered while something waits inside is interrupted as one never recovered is: what waits inside leaves with it;
> - an activity discarded after it was recovered and before it resumed is discarded as it resumes, not left waiting (an event based gateway's other targets, when a timer past due ends it as the run resumes).
>
> See `test/feature/coda-event-subprocess-feature.js`, `test/feature/coda-recovered-subprocess-feature.js` and `test/feature/coda-recovered-gateway-feature.js`.

- [Examples](/docs/Examples.md)
- [Handle extensions](/docs/Extension.md)
- [Write your own behaviour](/docs/Extend.md)
- [BPMN 2.0 conformance](/docs/Conformance.md)
- [Upgrade guide](/docs/Upgrade.md)

<!-- toc -->

- [Supported elements](#supported-elements)
- [Ecosystem](#ecosystem)

<!-- /toc -->

# Supported elements

The following elements are tested and supported.

- [Definition](/docs/Definition.md): Executable BPMN 2 definition
- [Process](/docs/Process.md): Executes and keeps track of activity elements
- AdHocSubProcess
- BpmnError
- BoundaryEvent
- [CallActivity](/docs/CallActivity.md)
- CancelEventDefinition
- [ConditionalEventDefinition](/docs/ConditionalEventDefinition.md)
- CompensateEventDefinition
  - compensate by outbound Association
- [DataObject](/docs/BpmnIO.md)
- [DataStore](/docs/BpmnIO.md)
- [DataStoreReference](/docs/BpmnIO.md)
- EndEvent
- Error
- ErrorEventDefinition
  - throw
  - catch
- [Escalation](/docs/MessageElements.md)
- EscalationEventDefinition
  - throw
  - catch
- EventBasedGateway
- ExclusiveGateway
- [InclusiveGateway](/docs/InclusiveGateway.md)
- IntermediateCatchEvent
- IntermediateThrowEvent
- [InputOutputSpecification](/docs/BpmnIO.md)
- LinkEventDefinition
  - throw
  - catch
- [Message](/docs/MessageElements.md)
- MessageEventDefinition
  - throw
  - catch
- MessageFlow
- [MultiInstanceLoopCharacteristics](/docs/LoopCharacteristics.md)
- [OutputExtension](/docs/Extension.md#extension-and-output)
- [ParallelGateway](/docs/ParallelGateway.md)
- Participant
- Lane: exposed on activity
- ManualTask: Same behaviour as SignalTask, see [SignalTask](/docs/SignalTask.md)
- [Property](/docs/BpmnIO.md)
- ReceiveTask
- ScriptTask
- [SequenceFlow](/docs/SequenceFlow.md)
- ServiceImplementation: ServiceTask implementation attribute behaviour
- [ServiceTask](/docs/ServiceTask.md)
- BusinessRuleTask: Same behaviour as ServiceTask, see [DMN](/docs/Conformance.md#business-rule-task-and-dmn)
- SendTask: Same behaviour as ServiceTask
- [Signal](/docs/MessageElements.md)
- SignalEventDefinition
  - throw
  - catch
- [SignalTask](/docs/SignalTask.md)
- [StandardLoopCharacteristics](/docs/LoopCharacteristics.md)
- [StartEvent](/docs/StartEvent.md)
- SubProcess
- Task
- TerminateEventDefinition
- [TimerEventDefinition](/docs/TimerEventDefinition.md)
  - timeDuration
  - timeDate
  - timeCycle
- Transaction
- UserTask: Same behaviour as SignalTask, see [SignalTask](/docs/SignalTask.md)

All activities share the same [base](/docs/Activity.md) and and [api](/docs/SharedApi.md).

# Ecosystem

Packages that build on or complement `bpmn-elements`:

- [bpmn-engine](https://github.com/paed01/bpmn-engine) — BPMN 2.0 execution engine wrapping `bpmn-elements`; the batteries-included way to run, stop, resume, and recover flows.
- [bpmn-middleware](https://github.com/zerodep/bpmn-middleware) — Express middleware exposing the engine over HTTP, with pluggable state storage.
- [@0dep/bpmn-extensions](https://github.com/zerodep/bpmn-extensions) — Flow extensions for `bpmn-elements`: FEEL expressions and the Zeebe-namespace BPMN extension elements.
- [@onify/flow-extensions](https://github.com/onify/flow-extensions) — Onify Flow extensions for `bpmn-elements`.
- [dmn-elements](https://github.com/zerodep/dmn-elements) — Executable DMN 1.3 decision elements; back a Business Rule Task with it.
- [BPMN Runner](https://0dep.se/run/) — Browser-based BPMN 2.0 and DMN runner built on `bpmn-elements`, `@0dep/bpmn-extensions`, and `dmn-elements`; run and step through diagrams client-side with live element highlighting, no data leaves the browser.
