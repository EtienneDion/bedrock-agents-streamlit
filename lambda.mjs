import { Message, streamText } from 'ai';
import { SigV4Signer } from '@aws-sdk/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { fromUtf8, toUtf8 } from '@aws-sdk/util-utf8-node';
import { Credentials } from '@aws-sdk/types';
import fetch from 'node-fetch';
import base64 from 'base-64';

const agentId = "RWRMVZLC8A";
const agentAliasId = "JTKGKFHPKP";
const theRegion = "ca-central-1";

async function getAWSCredentials() {
    const credentials = await defaultProvider()();
    return {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken
    };
}

async function sigv4Request(url, method = 'GET', body = null, headers = {}, service = 'execute-api', region = theRegion) {
    const credentials = await getAWSCredentials();
    
    const request = new HttpRequest({
        method,
        headers: {
            'host': new URL(url).host,
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined,
        protocol: 'https',
        hostname: new URL(url).hostname,
        path: new URL(url).pathname,
        query: new URL(url).searchParams,
    });
    
    const signer = new SigV4Signer({
        credentials,
        service,
        region,
    });
    
    const signedRequest = await signer.sign(request);
    
    return fetch(url, {
        method,
        headers: signedRequest.headers,
        body: signedRequest.body,
    });
}

async function askQuestion(question, url, endSession = false) {
    const requestBody = {
        inputText: question,
        enableTrace: true,
        endSession,
    };

    const response = await sigv4Request(
        url,
        'POST',
        requestBody,
        {
            'content-type': 'application/json',
            'accept': 'application/json',
        },
        'bedrock'
    );
    
    return decodeResponse(response);
}

async function decodeResponse(response) {
    const responseBody = await response.text();
    console.log("Decoded response", responseBody);
    
    const splitResponse = responseBody.split(':message-type');
    console.log("Split Response:", splitResponse);

    let finalResponse = "";
    for (let part of splitResponse) {
        if (part.includes("bytes")) {
            const encodedLastResponse = part.split("\"")[3];
            const decoded = base64.decode(encodedLastResponse);
            finalResponse = decoded.toString('utf-8');
            console.log(finalResponse);
        }
    }
    
    return finalResponse;
}

export const lambdaHandler = async (event) => {
    const { sessionId, question, endSession = "false" } = event;
    console.log(`Session: ${sessionId} asked question: ${question}`);
    
    const url = `https://bedrock-agent-runtime.${theRegion}.amazonaws.com/agents/${agentId}/agentAliases/${agentAliasId}/sessions/${sessionId}/text`;
    
    try {
        const response = await askQuestion(question, url, endSession === "true");
        return {
            statusCode: 200,
            body: JSON.stringify({ response }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
