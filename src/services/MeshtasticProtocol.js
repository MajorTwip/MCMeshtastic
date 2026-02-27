'use strict';

/**
 * MeshtasticProtocol.js
 *
 * Minimal encode/decode for Meshtastic MeshPackets using protobufjs.
 *
 * Proto definition (subset) used:
 *
 *   message Data {
 *     bytes  payload = 1;
 *     int32  portnum = 3;
 *   }
 *
 *   message MeshPacket {
 *     Data decoded = 3;
 *   }
 *
 * We only need portnum=DATA_APP (256) and a raw bytes payload for bridging.
 */

const protobuf = require('protobufjs');

// ── Inline proto definition ───────────────────────────────────────────────────

const PROTO_DEF = `
syntax = "proto3";

message Data {
  bytes  payload = 1;
  int32  portnum = 3;
}

message MeshPacket {
  Data decoded = 3;
}
`;

// ── Constants ─────────────────────────────────────────────────────────────────

/** Meshtastic portnum value for generic data payloads */
const PORTNUM_DATA_APP = 256;

// ── Module-level lazy-init ────────────────────────────────────────────────────

let _root = null;
let _MeshPacket = null;

function getTypes() {
  if (_root && _MeshPacket) {
    return { root: _root, MeshPacket: _MeshPacket };
  }
  _root = protobuf.parse(PROTO_DEF, { keepCase: true }).root;
  _MeshPacket = _root.lookupType('MeshPacket');
  return { root: _root, MeshPacket: _MeshPacket };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encode raw bytes as a MeshPacket with portnum=DATA_APP.
 * Returns the serialised protobuf bytes ready to write to toRadio.
 * @param {Uint8Array} payload
 * @returns {Uint8Array}
 */
function encodeMeshPacket(payload) {
  const { MeshPacket } = getTypes();

  const message = MeshPacket.create({
    decoded: {
      payload: payload,
      portnum: PORTNUM_DATA_APP,
    },
  });

  const err = MeshPacket.verify(message);
  if (err) {
    throw new Error(`MeshPacket verification failed: ${err}`);
  }

  return MeshPacket.encode(message).finish();
}

/**
 * Decode a MeshPacket from raw bytes (read from fromRadio).
 * Returns null if the packet has no decoded payload.
 * @param {Uint8Array} bytes
 * @returns {{ portnum: number, payload: Uint8Array } | null}
 */
function decodeMeshPacket(bytes) {
  const { MeshPacket } = getTypes();

  const message = MeshPacket.decode(bytes);
  const obj = MeshPacket.toObject(message, { bytes: Array });

  if (!obj.decoded) {
    return null;
  }

  const portnum = obj.decoded.portnum ?? 0;
  const payloadArr = obj.decoded.payload ?? [];

  return {
    portnum,
    payload: Uint8Array.from(payloadArr),
  };
}

module.exports = { encodeMeshPacket, decodeMeshPacket, PORTNUM_DATA_APP };
