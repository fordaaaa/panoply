# Testing AWS-touching code before you push

[Floci](https://floci.io/floci/) is a free, MIT-licensed local emulator for
~85 AWS services — no AWS account, no credentials, no per-call cost. panoply
ships a docker-compose template so `/verify` and `/cr-fix` can exercise real
AWS SDK calls against it instead of skipping that code path or hitting real
AWS.

## Setup

```bash
cp node_modules/panoply/templates/docker-compose.floci.yml .
docker compose -f docker-compose.floci.yml up -d
```

Point your AWS SDK client at it instead of real AWS:

```js
new S3Client({ endpoint: "http://localhost:4566", region: "us-east-1", forcePathStyle: true });
```

```python
boto3.client("s3", endpoint_url="http://localhost:4566")
```

No auth needed — Floci accepts any credentials, including the SDK defaults.

`SERVICES` in the compose file defaults to `s3,dynamodb,sqs,sns,lambda`; add
whatever else your code touches (see Floci's docs for the full list of the
85 supported services) via `FLOCI_SERVICES=s3,dynamodb,... docker compose ...`.

## How panoply uses it

- **`/verify`**'s Tests checker: if the diff touches AWS SDK calls and
  `docker-compose.floci.yml` exists in the repo (or Floci is already
  running on `:4566`), it starts Floci, points the test run's AWS
  endpoint env vars at it, runs the suite, and tears it down after —
  rather than reporting "N/A, no AWS account" for that code path.
- **`/cr-fix`** Step 6 (verify): same substitution when the fix under
  verification touches AWS-calling code.

If Floci isn't installed or Docker isn't available, both commands fall back
to their normal behavior — reporting untested AWS-dependent code paths as
N/A rather than a false pass. This is opt-in: nothing changes if you never
copy the compose file in.
