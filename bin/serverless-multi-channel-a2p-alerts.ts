#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ServerlessMultiChannelA2PAlertsStack } from '../lib/serverless-multi-channel-a2p-alerts-stack';
import { AwsSolutionsChecks, NagSuppressions} from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();
const stack = new ServerlessMultiChannelA2PAlertsStack(app, 'ServerlessMultiChannelA2PAlertsStack', {

  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  phoneNumberCall: '', //E164 format required; this is the phone number that will be called if the preference for a priority level is "call"
  phoneNumberSms: '', //E164 format required; this is the phone number that will receive the SMS if the preference for a priority level is "sms"
  email: '', //this is the email address where the email will be sent if the preference for a priority level is "email"
  highPriority: '', //call/sms/email; via which channel high priority messages will be delivered 
  mediumPriority: '', //call/sms/email; via which channel medium priority messages will be delivered 
  lowPriority: '', //call/sms/email; via which channel low priority messages will be delivered 
  connectInstanceId: '', //Amazon Connect instance ID
  countryCode: '', //Country code for source phone number for Amazon Connect; more info in the "Example" section in the README file
  apiToken: '' //token value that the Lambda Authorizer checks before allowing or rejecting the API call

});

// Simple rule informational messages
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-L1', reason: 'Custom resource Lambda construct, runtime cannot be set' },
  { id: 'AwsSolutions-DDB3', reason: 'PiT costly for PoC. Added comments ' },
  { id: 'AwsSolutions-APIG1', reason: 'Access logging would incur additional cost, not required for a sample. Added comment' },
  { id: 'AwsSolutions-APIG2', reason: 'Request validation is enabled via requestValidator resource' },
  { id: 'AwsSolutions-APIG3', reason: 'WAF would incur additional costs for the purposes of the sample/PoC. Added recommendation to README' },
  { id: 'AwsSolutions-COG4', reason: 'Token-based authorizer implemented instead to show capability. Added recommendation to README' },
  { id: 'AwsSolutions-IAM4', reason: 'AmazonAPIGatewayPushToCloudWatchLogs & AWSLambdaBasicExecutionRole; suitable for PoC. Latter also hindered by Custom Resource construct' },
  { id: 'AwsSolutions-IAM5', reason: 'Backend Lambda requires contact/* (https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonconnect.html) & CustomResourcePolicy Lambda exec role & construct-created Lambda service roles' },
]);