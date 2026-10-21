# Embedded Workflow One runtime

Source: `dsh-harness-one@0.12.0`, https://github.com/chumingjun/dsh-harness-one
License: MIT; see `LICENSE.workflow-one`.

The published orchestrator and prebuilt canvas are vendored so installing WorkBuddy does not download another plugin or build the canvas. The source release and exact adapted file hashes are recorded in `dsh-ccpg-orchestrator/workbuddy-patch.json`.

Reproduce from an unpacked upstream npm package:

```
node scripts/vendor/prepare.mjs <unpacked>/dsh-ccpg-orchestrator <new-directory> --runtime
```

The adapter adds immutable projection admission, per-node preset/cwd/model deployment, execution checkpoints, and completion suspension. The DSH product service captures upstream API handlers in-process and exposes only the authenticated WorkBuddy gateway. It does not seed the standalone upstream workflow skill. Canvas assets are unchanged.
