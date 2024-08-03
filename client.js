const net = require("net");
const fs = require("fs");

// Create a TCP client
const client = new net.Socket();

let response = [];
let missingSequences = new Set();
let allDataReceived = false;

// Create a variable to track if the connection should be closed
let connectionClosed = false;

//Request Type Initilize
const streamAllPacketsPayload = createPayloadToSend({
  callType: 1, // Stream All Packets
  resendSeq: 0, // Not applicable here, set to 0
});

const resendPacketPayload = (resendSeq) =>
  createPayloadToSend({
    callType: 2, // Resend Packet
    resendSeq, // Specific sequence number to resend
  });

// Connect to the server
const connect = () => {
  client.connect(3000, "localhost", () => {
    console.log("Connected to server.");
  });
};

const makeRequest = (request) => {
  client.write(request); // Request to stream all packets initially
};

connect();

makeRequest(streamAllPacketsPayload);

// Handle incoming data from the server
client.on("data", (data) => {
  console.log("Received data from server.");

  let offset = 0;
  while (offset < data.length) {
    const symbol = data.toString("ascii", offset, offset + 4);
    const buySellIndicator = data.toString("ascii", offset + 4, offset + 5);
    const quantity = data.readInt32BE(offset + 5);
    const price = data.readInt32BE(offset + 9);
    const packetSequence = data.readInt32BE(offset + 13);

    console.log({
      symbol,
      buySellIndicator,
      quantity,
      price,
      packetSequence,
    });

    response.push({
      symbol,
      buySellIndicator,
      quantity,
      price,
      packetSequence,
    });

    offset += 17;
  }

  if (allDataReceived) {
    requestMissingPackets();
  }
});

// Handle connection end
client.on("end", () => {
  console.log("Disconnected from server.");
  allDataReceived = true;

  // Identify and request missing sequences
  identifyMissingSequences();
  requestMissingPackets();
});

// Handle errors
client.on("error", (err) => {
  console.error("Error:", err);
});

// Function to create the binary payload
function createPayloadToSend({ callType, resendSeq }) {
  const buffer = Buffer.alloc(2); // Allocate a buffer of size 2 bytes

  // Write `callType` to the first byte
  buffer.writeUInt8(callType, 0);

  // Write `resendSeq` to the second byte
  buffer.writeUInt8(resendSeq, 1);

  return buffer;
}

// Identify missing sequences
function identifyMissingSequences() {
  response.sort((a, b) => a.packetSequence - b.packetSequence);
  let expectedSeq = 1;

  for (const packet of response) {
    while (expectedSeq < packet.packetSequence) {
      missingSequences.add(expectedSeq);
      expectedSeq++;
    }
    expectedSeq++;
  }

  console.log("Missing sequences:", [...missingSequences]);
}

// Request missing packets from the server
function requestMissingPackets() {
  if (missingSequences.size === 0) {
    writeToJSONFile();
    if (!connectionClosed) {
      client.end(); // Close the connection after all data is received
      connectionClosed = true;
    }
    return;
  }
  connect();
  for (const seq of missingSequences) {
    console.log(`Requesting missing packet with sequence: ${seq}`);
    if (!connectionClosed) {
      makeRequest(resendPacketPayload(seq));
    }
  }
  missingSequences.clear(); // Clear the set after requesting missing packets
}

// Write the final response to a JSON file
function writeToJSONFile() {
  const fileName = "output.json";
  response.sort((a, b) => a.packetSequence - b.packetSequence);
  fs.writeFile(fileName, JSON.stringify(response, null, 2), (err) => {
    if (err) {
      console.error("Error writing to JSON file:", err);
    } else {
      console.log(`Data successfully written to ${fileName}`);
    }
  });
}
