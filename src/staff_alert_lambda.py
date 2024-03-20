import boto3
import os
import json
from boto3.dynamodb.conditions import Key, Attr
from aws_lambda_powertools import Logger
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools import Tracer
from aws_lambda_powertools.utilities.jmespath_utils import extract_data_from_envelope
from aws_lambda_powertools.utilities.idempotency import (
    DynamoDBPersistenceLayer, IdempotencyConfig, idempotent
)

# Env variables
clinician_db_name = os.environ['ClinicianTable']
idempotency_table_name = os.environ['IdempotencyTable']
source_nr = os.environ['SourcePhoneNumber']
connect_instance_id = os.environ['ConnectInstanceId']
contact_flow_arn = os.environ['ContactFlowArn']
contact_flow_id = contact_flow_arn.split('/')[3]

# Idempotency
persistence_layer = DynamoDBPersistenceLayer(table_name=idempotency_table_name)
config = IdempotencyConfig(event_key_jmespath='powertools_json(body).["message_id"]')

# Clients
ddb = boto3.resource('dynamodb')
sns = boto3.client('sns')
connect = boto3.client('connect')

tracer = Tracer()
logger = Logger()

@idempotent(config=config, persistence_store=persistence_layer)
@tracer.capture_lambda_handler
@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
def handler(event, context):
    
    payload = extract_data_from_envelope(data=event, envelope='powertools_json(body)')

    message_id = payload.get('message_id') 
    patient_id = payload.get('patient_id')
    contact_id = payload.get('contact_id')
    description = payload.get('description')
    priority = payload.get('priority')

    logger.info('Retrieving parameters...')
    
    parameters = get_parameters(contact_id, priority)
    channel = parameters[0]
    destination = parameters[1]

    publish = None

    if destination != 'null':
        try:
            if channel == 'sms':
                logger.info('Attempting to send SMS...')
                publish = publish_sms(destination, patient_id, description)
            elif channel == 'email':
                logger.info('Attempting to send Email...')
                publish = publish_email(destination, patient_id, description)
            else:
                logger.info('Attempting voice call...')
                publish = publish_call(destination, connect_instance_id, contact_flow_id, patient_id, source_nr, description)
        except Exception as e:
            logger.exception('Error sending message')
            logger.exception('Details:', exc_info=True)
            raise e
    else:
        response = {
            'statusCode': 200,
            'body': 'Could not send message'
        }

    print(publish)

    response = {
        'statusCode': 200,
        'body': 'Message sent successfully'
    }

    print(f'response: {json.dumps(response)}')
    return response


def get_parameters(contact_id, priority):

    table = ddb.Table(clinician_db_name)

    ddb_priority = {
        'L':'LowPrio',
        'M':'MediumPrio',
        'H':'HighPrio'
    }.get(priority)

    dest_map = {
        'email': 'EmailDestination',
        'sms': 'SMSDestination',
        'call': 'CallDestination'
    }

    projection = f'ClinicianId, {ddb_priority}, EmailDestination, SMSDestination, CallDestination'  

    response = table.query(
        KeyConditionExpression=Key('ContactId').eq(contact_id),
        ProjectionExpression=projection,
    )

    channel = response['Items'][0][ddb_priority]
    attribute = dest_map[channel]
    destination = response['Items'][0][attribute]

    logger.info('Parameters retrieved!')
    return channel, destination


def publish_sms(destination, patient_id, description):
   
    message = description + ' ' + patient_id
    
    publish = sns.publish(
        TopicArn=destination,
        Message= message,
    )    
    logger.info('SMS Sent!')
    return publish 
    
def publish_email(destination, patient_id, description):
    
    message = description + ' ' + patient_id

    publish = sns.publish(
        TopicArn=destination,
        Message= message,
        Subject='Staff Alert Notifications - Blood Results Ready'
    )
    
    logger.info('Email Sent!')
    return publish
    
def publish_call(destination, connect_instance_id, contact_flow_id, patient_id, source_nr, description):

    start_outbound_voice_contact = connect.start_outbound_voice_contact(
        DestinationPhoneNumber=destination,
        InstanceId=connect_instance_id,
        ContactFlowId=contact_flow_id,
        SourcePhoneNumber=source_nr,
        Attributes={
            'Message': 'This is a message from Staff Alert. {}'.format(description),
            'Message2': patient_id
        }
    )

    logger.info('Voice Message Sent!')
    return(start_outbound_voice_contact)