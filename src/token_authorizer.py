# A simple token-based authorizer example to demonstrate how to use an authorization token 
# to allow or deny a request. In this example, the caller named 'user' is allowed to invoke 
# a request if the client-supplied token value is 'allow'. The caller is not allowed to invoke 
# the request if the token value is 'deny'. If the token value is 'unauthorized' or an empty
# string, the authorizer function returns an HTTP 401 status code. For any other token value, 
# the authorizer returns an HTTP 500 status code. 
# Note that token values are case-sensitive.

import json
import os

api_token = os.environ['token']


def handler(event, context):
    print(event)
    
    token = event['authorizationToken']
    
    if token == api_token:
        print('authorized')
        response = generatePolicy('user', 'Allow', event['methodArn'])
    else:
        print('unauthorized')
        raise Exception('Unauthorized') # Return a 401 Unauthorized response
        return 'unauthorized'
    try:
        return json.loads(response)
    except:
        print('unauthorized')
        return 'unauthorized' # Return a 500 response
def generatePolicy(principalId, effect, resource):
        authResponse = {}
        authResponse['principalId'] = principalId
        if (effect and resource):
            policyDocument = {}
            policyDocument['Version'] = '2012-10-17'
            policyDocument['Statement'] = [];
            statementOne = {}
            statementOne['Action'] = 'execute-api:Invoke'
            statementOne['Effect'] = effect
            statementOne['Resource'] = resource
            policyDocument['Statement'] = [statementOne]
            authResponse['policyDocument'] = policyDocument
        authResponse['context'] = {
            "stringKey": "stringval",
            "numberKey": 123,
            "booleanKey": True
        }
        authResponse_JSON = json.dumps(authResponse)
        return authResponse_JSON