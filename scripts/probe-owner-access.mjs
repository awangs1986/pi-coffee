import { inspectExecutionCapability } from "../dist/src/host/execution-capability.js";

const capability=await inspectExecutionCapability();
console.log(JSON.stringify(capability,null,2));
if(!capability.ownerEnvironment || !capability.passwordlessRoot)process.exitCode=1;
