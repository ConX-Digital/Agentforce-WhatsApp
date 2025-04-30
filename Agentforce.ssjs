<script runat="server">
// Load the Marketing Cloud Core library
Platform.Load("Core", "1.1.1");

// === CONFIGURATION ===
// Salesforce OAuth credentials
var clientId = "YOUR_SALESFORCE_CLIENT_ID";
var clientSecret = "YOUR_SALESFORCE_CLIENT_SECRET";

// Salesforce instance URLs
var sfOrgDomain = "https://YOUR_SALESFORCE_DOMAIN";
var sfApiHost = "https://YOUR_SALESFORCE_API_HOST";

// Einstein Bot agent ID
var agentId = "YOUR_AGENT_ID";

// Marketing Cloud token storage
var mctoken = "";

/**
 * Gets current timestamp in milliseconds
 */
function getTimestamp() {
    return new Date().getTime();
}

/**
 * Gets Salesforce access token using client credentials flow
 * Returns: Access token string
 */
function getAccessToken() {
    var url = sfOrgDomain + "/services/oauth2/token";
    var payload = "grant_type=client_credentials" +
                  "&client_id=" + clientId +
                  "&client_secret=" + clientSecret;

    var headers = [];
    var values = [];
    var response = [0];
    
    try {
        Platform.Function.HTTPPost(url, "application/x-www-form-urlencoded", payload, headers, values, response);
    } catch (e) {
        throw new Error("Error getting access token: " + Platform.Function.Stringify(e));
    }

    var parsedResponse = Platform.Function.ParseJSON(response[0]);
    if (!parsedResponse.access_token) {
        throw new Error("Failed to get token: " + response.Response[0]);
    }

    return parsedResponse.access_token;
}

/**
 * Gets Marketing Cloud access token.
 * Parameters:
 * - clientId2: MC client ID
 * - clientSecret2: MC client secret  
 * - subdomain: MC subdomain
 * - accountId: MC account ID
 */
function getMCToken(clientId2, clientSecret2, subdomain, accountId) {
    var url = "https://" + subdomain + ".auth.marketingcloudapis.com/v2/token";
    var payload = {
        grant_type: "client_credentials",
        client_id: clientId2,
        client_secret: clientSecret2,
        account_id: accountId
    };

    var headers = [];
    var values = [];
    var response = [0];

    Platform.Function.HTTPPost(url, "application/json", Stringify(payload), headers, values, response);
    var parsedResp = Platform.Function.ParseJSON(response[0]);

    if (!parsedResp.access_token) {
        throw new Error("Failed to get Marketing Cloud token");
    }
    mctoken = parsedResp.access_token;
}

// === MAIN LOGIC ===
try {
    // Get input parameters from POST request
    var body = Platform.Request.GetPostData();
    var input = Platform.Function.ParseJSON(body);
    var text = input.text;
    var contactId = input.contactId;
    var mobileNumber = input.mobileNumber;

    // Validate required text input
    if (!text) {
        Write(Stringify({ error: "Missing 'text' input" }));
        return;
    }

    // === 1. Get Salesforce Token ===
    var accessToken = getAccessToken();
    var authHeaders = ["Authorization"];
    var authValues = ["Bearer " + accessToken];
    
    // Look up existing session ID for contact
    var deName = "Contact_Sessions";
    var sessionId = Platform.Function.Lookup(deName, "sessionId", "contactId", contactId);

    // === 2. Start New Session (if needed) ===
    if (!sessionId) {
        var sessionUrl = sfApiHost + "/einstein/ai-agent/v1/agents/" + agentId + "/sessions";
        
        // Configure session parameters
        var sessionPayload = {
            externalSessionKey: Platform.Function.GUID(),
            instanceConfig: {
                endpoint: sfOrgDomain
            },
            tz: "America/Los_Angeles",
            variables: [
                {
                    name: "$Context.EndUserLanguage",
                    type: "Text",
                    value: "en_US"
                }
            ],
            featureSupport: "Streaming",
            streamingCapabilities: {
                chunkTypes: ["Text"]
            },
            bypassUser: true
        };

        var sessionResp = [0];
        
        try {
            Platform.Function.HTTPPost(sessionUrl, "application/json", Stringify(sessionPayload), authHeaders, authValues, sessionResp);
        } catch (e) {
            throw new Error("Session creation error: " + Platform.Function.Stringify(e));
        }
        
        // Parse and validate session response
        var parsedSessionResp = Platform.Function.ParseJSON(sessionResp[0]);
        if (!parsedSessionResp.sessionId) {
            throw new Error("Failed to start session: " + parsedSessionResp);
        }

        sessionId = parsedSessionResp.sessionId;
        
        // Store session ID for contact
        Platform.Function.InsertData(deName, ["contactId", "sessionId"], [contactId, sessionId]);
    }

    // === 3. Send Message to Agentforce Bot ===
    var messageUrl = sfApiHost + "/einstein/ai-agent/v1/sessions/" + sessionId + "/messages";
    var messagePayload = {
        message: {
            sequenceId: getTimestamp(),
            type: "Text",
            text: text
        },
        variables: []
    };

    var messageResp = HTTP.Post(messageUrl, "application/json", Stringify(messagePayload), authHeaders, authValues);

    if (messageResp.StatusCode != 200) {
        throw new Error("Failed to send message: " + messageResp.Response[0]);
    }

    var messageData = Platform.Function.ParseJSON(messageResp.Response[0]);
    var reply = messageData.messages && messageData.messages.length
                  ? messageData.messages[0].message
                  : "No response";

    var parsedReply;
    var botMessage;
    var productDesc;
    var imageUrl;
    var newReply = reply;

    // Attempt to parse the reply for additional product data
    try {
        parsedReply = messageData.messages[0];
        botMessage = parsedReply.message;
        var parsedBotResp = Platform.Function.ParseJSON(botMessage);
        if (parsedBotResp.product) {
            productDesc = parsedBotResp.product.description;
            imageUrl = parsedBotResp.product.imageUrl;
            newReply = parsedBotResp.message + " " + productDesc;
            reply = newReply;
        }
    } catch(e) {
        // If parsing fails, reply remains plain text
    }

    // Configure message definition and attributes based on content
    var definitionKey = imageUrl ? "testing-whatsapp-image" : "testing-whatsapp";
    var attributes = imageUrl 
      ? { text: newReply, image: imageUrl }
      : { text: reply };

    // === 4. Send WhatsApp Message via Marketing Cloud ===
    // Retrieve Marketing Cloud token (replace with your own MC credentials)
    getMCToken("YOUR_MC_CLIENT_ID", "YOUR_MC_CLIENT_SECRET", "YOUR_MC_SUBDOMAIN", "YOUR_MC_ACCOUNT_ID");

    var sendMessageHeaders = ["Authorization"];
    var sendMessageValues = ["Bearer " + mctoken];
    
    var sendMessagePayload = {
        definitionKey: definitionKey,
        recipients: [
            {
                contactKey: contactId,
                to: mobileNumber,
                attributes: attributes
            }
        ]
    };

    var sendMessageURL = "https://YOUR_MC_SUBDOMAIN.rest.marketingcloudapis.com/messaging/v1/ott/messages/";
    var sendMessageResp = [0];
  
    try {
        Platform.Function.HTTPPost(sendMessageURL, "application/json", Platform.Function.Stringify(sendMessagePayload), sendMessageHeaders, sendMessageValues, sendMessageResp);
    } catch(e) {
        throw new Error("Message sending error: " + Platform.Function.Stringify(e));
    }

    // Return successful response
    Write(Stringify({
        sessionId: sessionId,
        response: reply,
        sendMessageResp: sendMessageResp[0]
    }));

} catch (e) {
    Write(Stringify({ error: "Unhandled error", detail: String(e) }));
}
</script>
