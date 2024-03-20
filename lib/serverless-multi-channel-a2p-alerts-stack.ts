// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns_subscription from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as python from '@aws-cdk/aws-lambda-python-alpha';
import { aws_connect as connect } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AwsSdkCall } from 'aws-cdk-lib/custom-resources';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { RemovalPolicy, CfnResource, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { LambdaPowertoolsLayer } from 'cdk-aws-lambda-powertools-layer';
import { Key } from 'aws-cdk-lib/aws-kms';


interface AlertStackProps extends StackProps {
  phoneNumberCall: string;
  phoneNumberSms: string;
  email: string;
  highPriority: string;
  mediumPriority: string;
  lowPriority: string;
  connectInstanceId: string;
  countryCode: string;
  apiToken: string;
}

export class ServerlessMultiChannelA2PAlertsStack extends Stack {
  restApi: any;
  constructor(scope: Construct, id: string, props?: AlertStackProps) {
    super(scope, id, props);

    const entry = './src/'

    const clinicianTable = new dynamodb.Table(this, 'contactPrefTable', {
      partitionKey: { name: 'ContactId', type: dynamodb.AttributeType.STRING},
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      pointInTimeRecovery: false, // NOT recommended for production use
    });
    
    const idempotencyTable = new dynamodb.Table(this, 'idempotencyTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING},
      timeToLiveAttribute: 'expiration',
      removalPolicy: RemovalPolicy.DESTROY, // NOT recommended for production use
      pointInTimeRecovery: false, // NOT recommended for production use
    });

    const restApi = new RestApi(this, 'alertAPI',
    {
      restApiName: 'Staff Alert Rest API',
      endpointConfiguration: {
        types: [ apigateway.EndpointType.REGIONAL ]
      },
      deploy: true,
      deployOptions: {
        stageName: 'dev',
        tracingEnabled: true,
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
        // Recommended: accessLogDestination & accessLogFormat 
      },
      cloudWatchRole: true,
    });  

    /// API Authorization
    const lambdaAuthorizer = new python.PythonFunction(this, 'authorizerFunction', {
      entry,
      runtime: lambda.Runtime.PYTHON_3_12,
      index: 'token_authorizer.py',
      environment: {
        ['token']: props.apiToken
      },
      tracing: lambda.Tracing.ACTIVE
    });

    const tokenAuth = new apigateway.TokenAuthorizer(this, 'requestAuthorizer', {
      handler: lambdaAuthorizer
    });

    /// API Request Validator (opt)
    const requestValidator = new apigateway.RequestValidator(this, 'requestValidator', {
      restApi: restApi,
      requestValidatorName: 'requestValidatorBody',
      validateRequestBody: true,
    });

    const requestBodySchema = new apigateway.Model(this, 'requestBodySchema', {
      restApi: restApi,
      contentType: 'application/json',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          name: { type: apigateway.JsonSchemaType.STRING },
        },
        required: ['message_id', 'type', 'patient_id', 'contact_id', 'description', 'priority'],
      },
    })
    
    const endpoint = restApi.root.addResource('notification')
    const apiGatewayEndpoint = restApi.url

    const connectInstanceArn = `arn:aws:connect:${this.region}:${this.account}:instance/${props.connectInstanceId}`

    const flowJson = "{\"Version\":\"2019-10-30\",\"StartAction\":\"block1\",\"Metadata\":{\"entryPointPosition\":{\"x\":40,\"y\":40},\"ActionMetadata\":{\"123\":{\"position\":{\"x\":484.8,\"y\":95.2}},\"block1\":{\"position\":{\"x\":204.8,\"y\":36.8},\"isFriendlyName\":true}},\"Annotations\":[]},\"Actions\":[{\"Parameters\":{},\"Identifier\":\"123\",\"Type\":\"DisconnectParticipant\",\"Transitions\":{}},{\"Parameters\":{\"Text\":\"<speak> <prosody rate='slow'>\\n$.Attributes.Message\\n<say-as interpret-as='digits'>\\n$.Attributes.Message2\\n</say-as>\\n</prosody> </speak>\\n\"},\"Identifier\":\"block1\",\"Type\":\"MessageParticipant\",\"Transitions\":{\"NextAction\":\"123\",\"Errors\":[{\"NextAction\":\"123\",\"ErrorType\":\"NoMatchingError\"}]}}]}"

    const contactFlow = new connect.CfnContactFlow(this, 'connectContactFlow', {
      instanceArn: connectInstanceArn,
      name: 'StaffAlertOutboundCallFlow',
      type: 'CONTACT_FLOW',
      content: flowJson,
    });

    const contactFlowArn = contactFlow.ref

    // Define the phone number
    const sourcePhoneNumber = new connect.CfnPhoneNumber(this, 'connectSourceNr', {
      countryCode: props.countryCode,
      targetArn: connectInstanceArn,
      type: 'DID',
    });

    const powertoolsLayer = new LambdaPowertoolsLayer(this, 'powertoolsLayer', {
      includeExtras: true
    });

    const lambdaBackend = new python.PythonFunction(this, 'lambdaFunctionBackend', {
      entry,
      runtime: lambda.Runtime.PYTHON_3_12,
      index: 'staff_alert_lambda.py',
      environment: {
        ['IdempotencyTable']: idempotencyTable.tableName,
        ['ClinicianTable']: clinicianTable.tableName,
        ['SourcePhoneNumber']: sourcePhoneNumber.attrAddress,
        ['ConnectInstanceId']: props.connectInstanceId,
        ['ContactFlowArn']: contactFlowArn,
        ['POWERTOOLS_SERVICE_NAME']: 'StaffAlert',
      },
      layers: [powertoolsLayer],
      tracing: lambda.Tracing.ACTIVE
    });

    // Lambda roles and perms
    idempotencyTable.grantReadWriteData(lambdaBackend.role!)
    clinicianTable.grantReadData(lambdaBackend.role!)


    lambdaBackend.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['connect:StartOutboundVoiceContact'],
        resources: [`${connectInstanceArn}/contact/*`],
      }));

    const endpointMethod = endpoint.addMethod('POST', new apigateway.LambdaIntegration(lambdaBackend), {
      apiKeyRequired: false, //Set to true to enable, will require usage plans 
      authorizer: tokenAuth,
      requestModels: {
        'application/json': requestBodySchema,
      },
      requestValidatorOptions: {
        validateRequestBody: true,
      },
    });

    // Only create SNS topics if needed
    const smsNeeded = props.highPriority == 'sms' || props.mediumPriority === 'sms' || props.lowPriority === 'sms';
    const emailNeeded = props.highPriority == 'email' || props.mediumPriority === 'email' || props.lowPriority === 'email';

    const kmsKey = new Key(this, 'snsKey', {
      enableKeyRotation: true,
      description: 'KMS key for SNS topic',
      alias: 'sns-key', 
    });

    lambdaBackend.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [kmsKey.keyArn],
      }));

    let smsTopic; 
    if (smsNeeded) {
      smsTopic = new sns.Topic(this, 'smsTopic', 
      { masterKey: kmsKey, }
      );
      smsTopic.addSubscription(new sns_subscription.SmsSubscription(props.phoneNumberSms));
      smsTopic.grantPublish(lambdaBackend.role!)
    }    
    
    let emailTopic;
    if (emailNeeded) {
      emailTopic = new sns.Topic(this, 'emailTopic',
      { masterKey: kmsKey, }
      );
      emailTopic.addSubscription(new sns_subscription.EmailSubscription(props.email));
      emailTopic.grantPublish(lambdaBackend.role!)
    }
    
    // Custom resource for populating DynamoDB Clinician Table
    const item = {
      ContactId: {S: 'C-1'},
      HighPrio: {S: props.highPriority},
      MediumPrio: {S: props.mediumPriority},
      LowPrio: {S: props.lowPriority},
      CallDestination: {S: props.phoneNumberCall},
      SMSDestination: {S: smsTopic?.topicArn ?? 'null'},
      EmailDestination: {S: emailTopic?.topicArn ?? 'null'}
    };

    const awsSdkCallDynamoDB: AwsSdkCall = {
      service: 'DynamoDB',
      action: 'putItem',
      physicalResourceId: cr.PhysicalResourceId.of(clinicianTable + '_insert'),
      parameters: {
        TableName: clinicianTable.tableName,
        Item: item,
      }
    };

    const populateDynamoDBResource = new cr.AwsCustomResource(this, 'populateDynamoDB',
    {
      onCreate: awsSdkCallDynamoDB,
      onUpdate: awsSdkCallDynamoDB,
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
  }
}
