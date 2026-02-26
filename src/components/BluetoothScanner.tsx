/**
 * BluetoothScanner.tsx
 *
 * Renders a list of detected Meshtastic BLE devices and allows the user to
 * connect to one.
 */

import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import {BluetoothService, ScannedDevice} from '../services/BluetoothService';
import {useAppState, makeLog} from '../store/AppState';

interface Props {
  bleService: BluetoothService;
}

const SCAN_DURATION_MS = 10_000;

export default function BluetoothScanner({bleService}: Props) {
  const {state, dispatch} = useAppState();
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
      }
      bleService.stopScan();
    };
  }, [bleService]);

  function log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    dispatch({type: 'ADD_LOG', entry: makeLog(msg, level)});
  }

  function startScan() {
    setDevices([]);
    setScanning(true);
    dispatch({type: 'SET_BLE_STATUS', status: 'scanning'});

    bleService.scan(device => {
      setDevices(prev => {
        if (prev.find(d => d.id === device.id)) {return prev;}
        return [...prev, device];
      });
    }, SCAN_DURATION_MS);

    scanTimerRef.current = setTimeout(() => {
      setScanning(false);
      if (state.bleStatus === 'scanning') {
        dispatch({type: 'SET_BLE_STATUS', status: 'disconnected'});
      }
    }, SCAN_DURATION_MS);
  }

  async function connectDevice(device: ScannedDevice) {
    if (scanning) {
      bleService.stopScan();
      setScanning(false);
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
    }

    dispatch({type: 'SET_BLE_STATUS', status: 'connecting'});
    log(`Connecting to ${device.name ?? device.id}…`);

    try {
      await bleService.connect(device.id, bytes => {
        log(`BLE packet received: ${bytes.length} bytes`);
        dispatch({type: 'INCREMENT_BLE_PACKETS'});
      });

      dispatch({type: 'SET_BLE_STATUS', status: 'connected'});
      dispatch({type: 'SET_CONNECTED_DEVICE', id: device.id, name: device.name});
      log(`Connected to ${device.name ?? device.id}`);
    } catch (e) {
      const err = e as Error;
      dispatch({type: 'SET_BLE_STATUS', status: 'error'});
      log(`Connection failed: ${err.message}`, 'error');
      Alert.alert('Connection Error', err.message);
    }
  }

  async function disconnectDevice() {
    try {
      await bleService.disconnect();
      dispatch({type: 'SET_BLE_STATUS', status: 'disconnected'});
      dispatch({type: 'SET_CONNECTED_DEVICE', id: null, name: null});
      log('Disconnected from device.');
    } catch (e) {
      const err = e as Error;
      log(`Disconnect error: ${err.message}`, 'error');
    }
  }

  const isConnected = state.bleStatus === 'connected';
  const isConnecting = state.bleStatus === 'connecting';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bluetooth Scanner</Text>

      {/* Connected device banner */}
      {isConnected && state.connectedDeviceName && (
        <View style={styles.connectedBanner}>
          <Text style={styles.connectedText}>
            ✓ Connected: {state.connectedDeviceName}
          </Text>
          <TouchableOpacity onPress={disconnectDevice} style={styles.disconnectBtn}>
            <Text style={styles.disconnectBtnText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Scan button */}
      {!isConnected && (
        <TouchableOpacity
          style={[styles.scanBtn, scanning && styles.scanBtnActive]}
          onPress={startScan}
          disabled={scanning || isConnecting}>
          {scanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.scanBtnText}>
              {isConnecting ? 'Connecting…' : 'Scan for Devices'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Device list */}
      {devices.length === 0 && scanning && (
        <Text style={styles.hint}>Scanning for Meshtastic devices…</Text>
      )}
      {devices.length === 0 && !scanning && !isConnected && (
        <Text style={styles.hint}>No devices found. Tap Scan to start.</Text>
      )}

      <FlatList
        data={devices}
        keyExtractor={item => item.id}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.deviceRow}
            onPress={() => connectDevice(item)}
            disabled={isConnecting || isConnected}>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>
                {item.name ?? 'Unknown Device'}
              </Text>
              <Text style={styles.deviceId}>{item.id}</Text>
            </View>
            <Text style={styles.rssi}>
              {item.rssi != null ? `${item.rssi} dBm` : ''}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#f5f5f5'},
  title: {fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#222'},
  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#d4edda',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  connectedText: {color: '#155724', fontWeight: '600', flex: 1},
  disconnectBtn: {
    backgroundColor: '#dc3545',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disconnectBtnText: {color: '#fff', fontWeight: '600', fontSize: 13},
  scanBtn: {
    backgroundColor: '#007bff',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  scanBtnActive: {backgroundColor: '#0056b3'},
  scanBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  hint: {
    textAlign: 'center',
    color: '#888',
    marginTop: 24,
    fontSize: 14,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceInfo: {flex: 1},
  deviceName: {fontSize: 16, fontWeight: '600', color: '#333'},
  deviceId: {fontSize: 12, color: '#888', marginTop: 2},
  rssi: {fontSize: 13, color: '#555'},
});
