import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { getEnvironmentVariable } from "./script-env";

export async function publishS1AutomationAlert(subject: string, message: string): Promise<void> {
  const topicArn = getEnvironmentVariable("S1_SYNC_ALERT_TOPIC_ARN");
  if (!topicArn) throw new Error("S1_SYNC_ALERT_TOPIC_ARN is not set");
  const region = getEnvironmentVariable("AWS_REGION") ?? getEnvironmentVariable("AWS_DEFAULT_REGION");
  const client = new SNSClient(region ? { region } : {});
  try {
    await client.send(new PublishCommand({ TopicArn: topicArn, Subject: subject.slice(0, 100), Message: message }));
  } finally {
    client.destroy();
  }
}
