// index.ts
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Sha256 } from "@aws-crypto/sha256-node";
import fetch, { Response } from "node-fetch";

// ***************************************
// Global Constants and Environment Setup
// ***************************************

// Replace these with your actual agent values
const agentId = "<YOUR AGENT ID>";        // INPUT YOUR AGENT ID HERE
const agentAliasId = "<YOUR ALIAS ID>";    // INPUT YOUR ALIAS ID HERE
const theRegion = "us-west-2";

// (Optionally) set the AWS_REGION environment variable
process.env.AWS_REGION = theRegion;

// ***************************************
// SigV4-Signed Request Function
// ***************************************

/**
 * Sends an HTTP request signed with SigV4.
 *
 * @param url The request URL.
 * @param method HTTP method (defaults to GET).
 * @param body The request body (as a JSON string, if provided).
 * @param params Optional query parameters.
 * @param headers Optional request headers.
 * @param service The AWS service name (defaults to 'execute-api').
 * @param region The AWS region (defaults to process.env.AWS_REGION).
 * @param credentials Optional AWS credentials (if not provided, the default provider is used).
 * @returns A Promise resolving to the HTTP Response.
 */
async function sigv4Request(
  url: string,
  method: string = "GET",
  body?: string,
  params?: { [key: string]: string },
  headers?: { [key: string]: string },
  service: string = "execute-api",
  region: string = process.env.AWS_REGION || "us-west-2",
  credentials?: any
): Promise<Response> {
  // Parse the URL
  const parsedUrl = new URL(url);

  // Build query parameters
  let queryParams: { [key: string]: string } = {};
  if (params) {
    queryParams = params;
  } else {
    parsedUrl.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
  }

  // Construct an HttpRequest object from the AWS SDK
  const httpRequest = new HttpRequest({
    protocol: parsedUrl.protocol, // e.g. "https:"
    hostname: parsedUrl.hostname,
    port: parsedUrl.port ? parseInt(parsedUrl.port) : undefined,
    method: method,
    path: parsedUrl.pathname,
    query: queryParams,
    headers: headers || {},
    body: body,
  });

  // Create the signer – if credentials aren’t passed, use the default provider
  const signer = new SignatureV4({
    credentials: credentials || defaultProvider(),
    region: region,
    service: service,
    sha256: Sha256,
  });

  // Sign the request
  const signedRequest = await signer.sign(httpRequest);

  // Rebuild the URL including query parameters
  let queryString = "";
  if (signedRequest.query && Object.keys(signedRequest.query).length > 0) {
    queryString =
      "?" + new URLSearchParams(signedRequest.query as any).toString();
  }
  const finalUrl = `${signedRequest.protocol}//${signedRequest.hostname}${
    signedRequest.port ? ":" + signedRequest.port : ""
  }${signedRequest.path}${queryString}`;

  // Prepare options for the HTTP request (using fetch)
  const fetchOptions: RequestInit = {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.body,
  };

  // Send the HTTP request and return the response
  const response = await fetch(finalUrl, fetchOptions);
  return response;
}

// ***************************************
// Response Decoding Function
// ***************************************

/**
 * Decodes the response returned from the API call.
 *
 * @param response The Response object from fetch.
 * @returns A Promise that resolves with a tuple: [capturedTrace, finalResponse]
 */
async function decodeResponse(
  response: Response
): Promise<[string, string]> {
  // Instead of redirecting stdout as in Python, we will collect log messages in an array.
  const capturedOutput: string[] = [];

  // Read the complete response text
  const responseText = await response.text();
  capturedOutput.push("Decoded response: " + responseText);

  // Split the response based on the marker ":message-type"
  const splitResponse = responseText.split(":message-type");
  capturedOutput.push(`Split Response: ${JSON.stringify(splitResponse)}`);
  capturedOutput.push(`length of split: ${splitResponse.length}`);

  // Process each split part
  for (let idx = 0; idx < splitResponse.length; idx++) {
    if (splitResponse[idx].includes("bytes")) {
      const parts = splitResponse[idx].split('"');
      if (parts.length > 3) {
        const encodedLastResponse = parts[3];
        try {
          const decodedBuffer = Buffer.from(encodedLastResponse, "base64");
          const finalResponsePart = decodedBuffer.toString("utf-8");
          capturedOutput.push(finalResponsePart);
        } catch (err) {
          capturedOutput.push(`Error decoding base64 at index ${idx}: ${err}`);
        }
      }
    } else {
      capturedOutput.push(`no bytes at index ${idx}`);
      capturedOutput.push(splitResponse[idx]);
    }
  }

  const lastResponse = splitResponse[splitResponse.length - 1];
  capturedOutput.push(`Lst Response: ${lastResponse}`);
  let finalResponse: string = "";

  if (lastResponse.includes("bytes")) {
    capturedOutput.push("Bytes in last response");
    const parts = lastResponse.split('"');
    if (parts.length > 3) {
      const encodedLastResponse = parts[3];
      const decodedBuffer = Buffer.from(encodedLastResponse, "base64");
      finalResponse = decodedBuffer.toString("utf-8");
    }
  } else {
    capturedOutput.push("no bytes in last response");
    const searchString = 'finalResponse":';
    const startIdx = responseText.indexOf(searchString);
    if (startIdx !== -1) {
      const part1 = responseText.substring(startIdx + searchString.length);
      const endIdx = part1.indexOf('"}');
      if (endIdx !== -1) {
        const part2 = part1.substring(0, endIdx + 2);
        try {
          const parsed = JSON.parse(part2);
          finalResponse = parsed["text"] || "";
        } catch (err) {
          capturedOutput.push(`Error parsing JSON: ${err}`);
        }
      }
    }
  }

  // Perform string replacements as in the original Python logic
  finalResponse = finalResponse.replace(/"/g, "");
  finalResponse = finalResponse.replace(/{input:{value:/g, "");
  finalResponse = finalResponse.replace(/,source:null}}/g, "");

  const llmResponse = finalResponse;

  // Return the collected log output and the final response
  return [capturedOutput.join("\n"), llmResponse];
}

// ***************************************
// askQuestion Function
// ***************************************

/**
 * Calls the signed API endpoint with the given question.
 *
 * @param question The question text.
 * @param url The full URL to call.
 * @param endSession Whether to end the session.
 * @returns A Promise that resolves with a tuple: [capturedTrace, finalResponse]
 */
async function askQuestion(
  question: string,
  url: string,
  endSession: boolean = false
): Promise<[string, string]> {
  const myobj = {
    inputText: question,
    enableTrace: true,
    endSession: endSession,
  };

  const body = JSON.stringify(myobj);

  // Call sigv4Request using HTTP POST with the proper headers and service name 'bedrock'
  const response = await sigv4Request(
    url,
    "POST",
    body,
    undefined,
    {
      "content-type": "application/json",
      accept: "application/json",
    },
    "bedrock",
    theRegion
  );

  return await decodeResponse(response);
}

// ***************************************
// Lambda Handler
// ***************************************

/**
 * The AWS Lambda handler function.
 *
 * @param event The Lambda event, expected to contain "sessionId", "question", and optionally "endSession".
 * @param context The Lambda context.
 * @returns A response object with a statusCode and a body.
 */
export const lambdaHandler = async (
  event: any,
  context: any
): Promise<any> => {
  const sessionId = event.sessionId;
  const question = event.question;
  let endSession = false;

  console.log(`Session: ${sessionId} asked question: ${question}`);

  if (event.endSession && event.endSession === "true") {
    endSession = true;
  }

  // Construct the URL similarly to the Python version
  const url = `https://bedrock-agent-runtime.${theRegion}.amazonaws.com/agents/${agentId}/agentAliases/${agentAliasId}/sessions/${sessionId}/text`;

  try {
    const [responseOutput, traceData] = await askQuestion(
      question,
      url,
      endSession
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        response: responseOutput,
        trace_data: traceData,
      }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: e.toString(),
      }),
    };
  }
};