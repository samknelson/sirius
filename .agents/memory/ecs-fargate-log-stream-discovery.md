---
name: ECS Fargate log-stream discovery
description: Reliable CloudWatch stream discovery for one-off ECS migration tasks.
---

Do not depend on ECS DescribeTasks returning a container `logStreamName` for Fargate one-offs. Derive the stream as `<awslogs-stream-prefix>/<container-name>/<task-id>` from the task definition's awslogs configuration and the launched task ARN.

**Why:** A healthy migration preflight emitted CloudWatch logs and exited zero, while DescribeTasks never exposed `logStreamName`; polling that field falsely reported that no stream appeared.

**How to apply:** Read `awslogs-stream-prefix` from the task definition, use the known container name, and take the final path segment of the task ARN. Let CloudWatch event polling handle stream-creation delay.