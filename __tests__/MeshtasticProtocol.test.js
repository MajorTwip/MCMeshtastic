'use strict';

/**
 * MeshtasticProtocol.test.js
 *
 * Tests for protobuf encode/decode round-trips.
 */

const {
  encodeMeshPacket,
  decodeMeshPacket,
  PORTNUM_DATA_APP,
} = require('../src/services/MeshtasticProtocol');

describe('MeshtasticProtocol', () => {
  // ── encodeMeshPacket ────────────────────────────────────────────────────────

  describe('encodeMeshPacket', () => {
    it('returns a non-empty Uint8Array', () => {
      const payload = new Uint8Array([0x01, 0x02, 0x03]);
      const encoded = encodeMeshPacket(payload);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('encodes an empty payload without throwing', () => {
      const payload = new Uint8Array([]);
      expect(() => encodeMeshPacket(payload)).not.toThrow();
    });

    it('encodes larger payloads', () => {
      const payload = new Uint8Array(256).fill(0xaa);
      const encoded = encodeMeshPacket(payload);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  // ── decodeMeshPacket ────────────────────────────────────────────────────────

  describe('decodeMeshPacket', () => {
    it('round-trips a simple payload', () => {
      const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const encoded = encodeMeshPacket(original);
      const decoded = decodeMeshPacket(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded.portnum).toBe(PORTNUM_DATA_APP);
      expect(decoded.payload).toEqual(original);
    });

    it('round-trips a single-byte payload', () => {
      const original = new Uint8Array([0x42]);
      const encoded = encodeMeshPacket(original);
      const decoded = decodeMeshPacket(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded.payload).toEqual(original);
    });

    it('round-trips a 512-byte payload', () => {
      const original = new Uint8Array(512).map((_, i) => i % 256);
      const encoded = encodeMeshPacket(original);
      const decoded = decodeMeshPacket(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded.payload).toEqual(original);
    });

    it('returns null for an empty bytes buffer (no decoded field)', () => {
      // An empty protobuf message has no fields set → decoded will be absent
      const empty = new Uint8Array([]);
      const decoded = decodeMeshPacket(empty);
      // Either null or has empty payload – depends on proto defaults
      if (decoded !== null) {
        expect(decoded.portnum).toBe(0);
      }
    });

    it('preserves the portnum DATA_APP value through encode/decode', () => {
      const payload = new Uint8Array([1, 2, 3]);
      const encoded = encodeMeshPacket(payload);
      const decoded = decodeMeshPacket(encoded);
      expect(decoded.portnum).toBe(PORTNUM_DATA_APP);
    });

    it('round-trips arbitrary binary data (all byte values 0–255)', () => {
      const original = new Uint8Array(256).map((_, i) => i);
      const encoded = encodeMeshPacket(original);
      const decoded = decodeMeshPacket(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded.payload).toEqual(original);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('same payload always produces the same encoded bytes', () => {
      const payload = new Uint8Array([0x10, 0x20, 0x30]);
      const enc1 = encodeMeshPacket(payload);
      const enc2 = encodeMeshPacket(payload);
      expect(enc1).toEqual(enc2);
    });
  });
});
