'use strict';

/**
 * BridgeService.test.js
 *
 * Tests for BridgeService routing logic using mocked BT and multicast services.
 */

const { BridgeService } = require('../src/services/BridgeService');
const { BluetoothService } = require('../src/services/BluetoothService');
const { MulticastService } = require('../src/services/MulticastService');
const { encodeMeshPacket } = require('../src/services/MeshtasticProtocol');

// ── Mocks ─────────────────────────────────────────────────────────────────────

// We mock the module-level imports so BridgeService uses our fakes
jest.mock('../src/services/BluetoothService');
jest.mock('../src/services/MulticastService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBleService() {
  return new BluetoothService(() => {});
}

function makeConfig() {
  return {
    multicastGroup: '224.0.0.251',
    multicastPort: 5353,
    deviceId: 'device-abc',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BridgeService', () => {
  let bleService;
  let logs;
  let packetCounts;

  beforeEach(() => {
    jest.clearAllMocks();

    bleService = makeBleService();
    bleService.connect.mockResolvedValue(undefined);
    bleService.disconnect.mockResolvedValue(undefined);
    bleService.sendPacket.mockResolvedValue(undefined);
    Object.defineProperty(bleService, 'isConnected', { get: () => true });

    // Make MulticastService constructor return a mock instance with start/stop/send
    MulticastService.prototype.start = jest.fn().mockResolvedValue(undefined);
    MulticastService.prototype.stop = jest.fn();
    MulticastService.prototype.send = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(MulticastService.prototype, 'isActive', {
      get: jest.fn().mockReturnValue(true),
      configurable: true,
    });

    logs = [];
    packetCounts = { ble: 0, udp: 0 };
  });

  // ── start / stop ─────────────────────────────────────────────────────────

  describe('start()', () => {
    it('connects BLE and starts multicast', async () => {
      const bridge = new BridgeService(
        bleService,
        (msg) => logs.push(msg),
        () => {},
      );

      await bridge.start(makeConfig());

      expect(bleService.connect).toHaveBeenCalledWith('device-abc', expect.any(Function));
      expect(MulticastService.prototype.start).toHaveBeenCalled();
      expect(bridge.isRunning).toBe(true);
    });

    it('does not start twice if already running', async () => {
      const bridge = new BridgeService(bleService, (msg) => logs.push(msg), () => {});

      await bridge.start(makeConfig());
      await bridge.start(makeConfig()); // second call should be no-op

      expect(bleService.connect).toHaveBeenCalledTimes(1);
    });

    it('throws and cleans up multicast if BLE connect fails', async () => {
      bleService.connect.mockRejectedValue(new Error('BLE connect failed'));

      const bridge = new BridgeService(bleService, () => {}, () => {});

      await expect(bridge.start(makeConfig())).rejects.toThrow('BLE connect failed');
      expect(MulticastService.prototype.stop).toHaveBeenCalled();
      expect(bridge.isRunning).toBe(false);
    });

    it('throws if multicast start fails', async () => {
      MulticastService.prototype.start = jest.fn().mockRejectedValue(new Error('bind failed'));

      const bridge = new BridgeService(bleService, () => {}, () => {});

      await expect(bridge.start(makeConfig())).rejects.toThrow('bind failed');
      expect(bridge.isRunning).toBe(false);
    });
  });

  describe('stop()', () => {
    it('disconnects BLE and stops multicast', async () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.start(makeConfig());
      await bridge.stop();

      expect(bleService.disconnect).toHaveBeenCalled();
      expect(MulticastService.prototype.stop).toHaveBeenCalled();
      expect(bridge.isRunning).toBe(false);
    });

    it('is a no-op if bridge is not running', async () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.stop(); // should not throw
      expect(bleService.disconnect).not.toHaveBeenCalled();
    });
  });

  // ── UDP → BLE routing ─────────────────────────────────────────────────────

  describe('UDP -> BLE routing', () => {
    it('encodes UDP payload as MeshPacket and sends via BLE', async () => {
      let capturedBlePacket = null;
      bleService.sendPacket.mockImplementation(async (bytes) => {
        capturedBlePacket = bytes;
      });

      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.start(makeConfig());

      // Grab the message callback passed to MulticastService constructor
      // The constructor is called with (group, port, onMessage, onLog)
      const onMessage = MulticastService.mock.calls[0][2];

      const testPayload = new Uint8Array([0x01, 0x02, 0x03]);
      onMessage(testPayload, { address: '224.0.0.251', port: 5353 });

      // Allow any async operations to settle
      await Promise.resolve();

      expect(bleService.sendPacket).toHaveBeenCalledTimes(1);
      expect(capturedBlePacket).not.toBeNull();
      // The encoded packet should be a valid protobuf MeshPacket
      expect(capturedBlePacket.length).toBeGreaterThan(0);
    });

    it('increments udp packet counter', async () => {
      const onCount = jest.fn();
      const bridge = new BridgeService(bleService, () => {}, onCount);
      await bridge.start(makeConfig());

      const onMessage = MulticastService.mock.calls[0][2];

      onMessage(new Uint8Array([0xab]), { address: '224.0.0.251', port: 5353 });
      await Promise.resolve();

      expect(onCount).toHaveBeenCalledWith('udp');
    });
  });

  // ── BLE → UDP routing ─────────────────────────────────────────────────────

  describe('BLE -> UDP routing', () => {
    it('decodes MeshPacket from BLE and sends payload via multicast', async () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.start(makeConfig());

      // Grab the BLE packet callback
      const blePacketCallback = bleService.connect.mock.calls[0][1];

      // Encode a test payload as a MeshPacket (simulating what Meshtastic sends)
      const testPayload = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
      const meshPacketBytes = encodeMeshPacket(testPayload);

      blePacketCallback(meshPacketBytes);
      await Promise.resolve();

      expect(MulticastService.prototype.send).toHaveBeenCalledTimes(1);
      const sentBytes = MulticastService.prototype.send.mock.calls[0][0];
      expect(sentBytes).toEqual(testPayload);
    });

    it('increments ble packet counter on valid DATA_APP packet', async () => {
      const onCount = jest.fn();
      const bridge = new BridgeService(bleService, () => {}, onCount);
      await bridge.start(makeConfig());

      const blePacketCallback = bleService.connect.mock.calls[0][1];

      const meshPacketBytes = encodeMeshPacket(new Uint8Array([0x11, 0x22]));
      blePacketCallback(meshPacketBytes);
      await Promise.resolve();

      expect(onCount).toHaveBeenCalledWith('ble');
    });

    it('does not send to multicast when BLE packet has no decoded field', async () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.start(makeConfig());

      const blePacketCallback = bleService.connect.mock.calls[0][1];

      // Empty bytes → decodeMeshPacket returns null
      blePacketCallback(new Uint8Array([]));
      await Promise.resolve();

      // send should not be called since there's no payload
      expect(MulticastService.prototype.send).not.toHaveBeenCalled();
    });

    it('logs error and does not crash on malformed BLE bytes', async () => {
      const errorLogs = [];
      const bridge = new BridgeService(
        bleService,
        (msg, level) => {
          if (level === 'error') {
            errorLogs.push(msg);
          }
        },
        () => {},
      );
      await bridge.start(makeConfig());

      const blePacketCallback = bleService.connect.mock.calls[0][1];

      // Bytes that fail proto decode (truncated field)
      blePacketCallback(new Uint8Array([0xff, 0xff, 0xff]));
      await Promise.resolve();

      // Should have logged an error but not thrown
      expect(errorLogs.length).toBeGreaterThan(0);
    });
  });

  // ── isRunning ─────────────────────────────────────────────────────────────

  describe('isRunning', () => {
    it('is false before start', () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      expect(bridge.isRunning).toBe(false);
    });

    it('is true after start, false after stop', async () => {
      const bridge = new BridgeService(bleService, () => {}, () => {});
      await bridge.start(makeConfig());
      expect(bridge.isRunning).toBe(true);
      await bridge.stop();
      expect(bridge.isRunning).toBe(false);
    });
  });
});
