<script runat="server">
Platform.Load("Core", "1.1.1");

// ---- CONFIGURATION ----
var clientId = 'YOUR_CLIENT_ID';
var clientSecret = 'YOUR_CLIENT_SECRET';
var authBaseUrl = 'https://YOUR_AUTH_BASE_URL';
var restBaseUrl = 'https://YOUR_REST_BASE_URL';

// ---- STEP 1: RECEIVE AND PARSE JSON PAYLOAD ----
var payload = Platform.Request.GetPostData();
var parsed = Platform.Function.ParseJSON(payload);
var message = parsed[0];
var audioId = message.messageBody.audio?.id;
var channelId = message.channelId;
var senderType = message.senderType;

if (!channelId || !senderType) {
    return; // Required fields missing
}

if (!audioId && message.messageType === "text") {
    var agentUrl = "https://cloud.info.lc.ac.ae/agentforce-api";
    var agentPayload = {
        text: message.messageBody.text.body,
        contactId: message.contactId,
        mobileNumber: message.mobileNumber
    };

    var agentResponse = [0];
    var temp = Platform.Function.HTTPPost(
        agentUrl,
        "application/json",
        Platform.Function.Stringify(agentPayload),
        [],
        [],
        agentResponse
    );

}
else if (message.messageType === "audio") {
    // Step 2: Build new payload for Node.js app
    var outgoingPayload = Platform.Function.Stringify({
        audioId: audioId,
        channelId: channelId,
        senderType: senderType,
        mobileNumber: message.mobileNumber,
        timestampUTC: message.timestampUTC,
        contactId: message.contactId
    });

    // Step 3: Send POST to Node.js endpoint
    var endpoint = "https://whatsapp-demo.onrender.com/upload-audio";
    try {
        var response = HTTP.Post(endpoint, "application/json", outgoingPayload, [], []);
        // Optionally handle the response
    } catch (postError) {
        Write("HTTP POST error: " + String(postError));
    }

    Write(Platform.Function.Stringify(response));
}
</script>
