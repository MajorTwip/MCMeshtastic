'use strict';

/**
 * config.js
 *
 * Parses configuration from CLI arguments and environment variables.
 *
 * CLI options (take precedence over env vars):
 *   --device <id>            BLE device ID to connect to
 *   --multicast-group <ip>   Multicast group IP  (default: 224.0.0.251)
 *   --multicast-port <port>  UDP port            (default: 5353)
 *   --scan-duration <ms>     BLE scan duration   (default: 15000)
 *   -h, --help               Print usage and exit
 *
 * Environment variables (fallback when CLI option is not provided):
 *   BLE_DEVICE_ID      – device ID to use without scanning
 *   MULTICAST_GROUP    – multicast group IP
 *   MULTICAST_PORT     – UDP port number
 *   SCAN_DURATION      – scan duration in milliseconds
 */

function printHelp() {
  console.log(`MCMeshtastic - Meshtastic <-> UDP Multicast Bridge

Usage:
  node index.js [options]

Options:
  --device <id>            BLE device ID (auto-detected via scan if omitted)
  --multicast-group <ip>   Multicast group IP  (default: 224.0.0.251)
  --multicast-port <port>  UDP port            (default: 5353)
  --scan-duration <ms>     BLE scan duration   (default: 15000)
  -h, --help               Show this help

Environment variables (used as fallback when CLI option is absent):
  BLE_DEVICE_ID, MULTICAST_GROUP, MULTICAST_PORT, SCAN_DURATION`);
}

/**
 * Parse configuration from process.argv and process.env.
 * @returns {{ multicastGroup: string, multicastPort: number, deviceId: string|null, scanDuration: number }}
 */
function parseConfig() {
  const config = {
    multicastGroup: process.env.MULTICAST_GROUP || '224.0.0.251',
    multicastPort: parseInt(process.env.MULTICAST_PORT || '5353', 10),
    deviceId: process.env.BLE_DEVICE_ID || null,
    scanDuration: parseInt(process.env.SCAN_DURATION || '15000', 10),
  };

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-h' || args[i] === '--help')) {
      printHelp();
      process.exit(0);
    } else if (args[i] === '--device' && args[i + 1]) {
      config.deviceId = args[++i];
    } else if (args[i] === '--multicast-group' && args[i + 1]) {
      config.multicastGroup = args[++i];
    } else if (args[i] === '--multicast-port' && args[i + 1]) {
      config.multicastPort = parseInt(args[++i], 10);
    } else if (args[i] === '--scan-duration' && args[i + 1]) {
      config.scanDuration = parseInt(args[++i], 10);
    }
  }

  return config;
}

module.exports = { parseConfig, printHelp };
