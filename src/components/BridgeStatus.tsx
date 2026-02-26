/**
 * BridgeStatus.tsx
 *
 * Displays:
 *   - BLE connection status
 *   - Multicast status
 *   - Bridge start/stop control
 *   - Live packet counters
 *   - Scrollable log with level-coloured entries
 */

import React, {useRef, useEffect} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import {useAppState, LogEntry, makeLog} from '../store/AppState';
import {BridgeService} from '../services/BridgeService';
import {BluetoothService} from '../services/BluetoothService';

interface Props {
  bridgeService: BridgeService;
  bleService: BluetoothService;
}

export default function BridgeStatus({bridgeService, bleService}: Props) {
  const {state, dispatch} = useAppState();
  const listRef = useRef<FlatList<LogEntry>>(null);

  // Auto-scroll log to bottom when new entries arrive
  useEffect(() => {
    if (state.log.length > 0) {
      listRef.current?.scrollToEnd({animated: true});
    }
  }, [state.log.length]);

  function log(msg: string, level: LogEntry['level'] = 'info') {
    dispatch({type: 'ADD_LOG', entry: makeLog(msg, level)});
  }

  async function toggleBridge() {
    if (bridgeService.isRunning) {
      try {
        await bridgeService.stop();
        dispatch({type: 'SET_BRIDGE_ACTIVE', active: false});
        dispatch({type: 'SET_MULTICAST_ACTIVE', active: false});
      } catch (e) {
        const err = e as Error;
        log(`Stop error: ${err.message}`, 'error');
      }
      return;
    }

    // Need a connected device to start the bridge
    if (state.bleStatus !== 'connected' || !state.connectedDeviceId) {
      Alert.alert(
        'Not Connected',
        'Please connect to a Meshtastic device in the Bluetooth tab first.',
      );
      return;
    }

    try {
      await bridgeService.start({
        multicastGroup: state.multicastGroup,
        multicastPort: state.multicastPort,
        deviceId: state.connectedDeviceId,
      });
      dispatch({type: 'SET_BRIDGE_ACTIVE', active: true});
      dispatch({type: 'SET_MULTICAST_ACTIVE', active: true});
    } catch (e) {
      const err = e as Error;
      dispatch({type: 'SET_BRIDGE_ACTIVE', active: false});
      dispatch({type: 'SET_MULTICAST_ACTIVE', active: false});
      log(`Bridge start failed: ${err.message}`, 'error');
      Alert.alert('Bridge Error', err.message);
    }
  }

  const bleColor = statusColor(state.bleStatus);
  const bleLabel = state.bleStatus.charAt(0).toUpperCase() + state.bleStatus.slice(1);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bridge Status</Text>

      {/* Status cards */}
      <View style={styles.statusGrid}>
        <StatusCard
          label="BLE"
          value={bleLabel}
          sub={state.connectedDeviceName ?? undefined}
          color={bleColor}
        />
        <StatusCard
          label="Multicast"
          value={state.multicastActive ? 'Active' : 'Inactive'}
          sub={`${state.multicastGroup}:${state.multicastPort}`}
          color={state.multicastActive ? '#28a745' : '#6c757d'}
        />
      </View>

      {/* Packet counters */}
      <View style={styles.counterRow}>
        <CounterCard label="BLE → UDP" count={state.packetsFromBle} color="#17a2b8" />
        <CounterCard label="UDP → BLE" count={state.packetsFromUdp} color="#fd7e14" />
      </View>

      {/* Bridge toggle */}
      <TouchableOpacity
        style={[styles.bridgeBtn, bridgeService.isRunning ? styles.bridgeBtnStop : styles.bridgeBtnStart]}
        onPress={toggleBridge}>
        <Text style={styles.bridgeBtnText}>
          {bridgeService.isRunning ? '⏹  Stop Bridge' : '▶  Start Bridge'}
        </Text>
      </TouchableOpacity>

      {/* Log header */}
      <View style={styles.logHeader}>
        <Text style={styles.logTitle}>Log</Text>
        <TouchableOpacity
          onPress={() => dispatch({type: 'CLEAR_LOG'})}
          style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Log list */}
      <FlatList
        ref={listRef}
        data={state.log}
        keyExtractor={item => String(item.id)}
        style={styles.logList}
        contentContainerStyle={styles.logContent}
        renderItem={({item}) => (
          <View style={styles.logRow}>
            <Text style={styles.logTime}>
              {item.timestamp.slice(11, 23)}
            </Text>
            <Text style={[styles.logMsg, logTextStyle(item.level)]}>
              {item.message}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.logEmpty}>No log entries yet.</Text>
        }
      />
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <View style={[styles.statusCard, {borderLeftColor: color}]}>
      <Text style={styles.statusCardLabel}>{label}</Text>
      <Text style={[styles.statusCardValue, {color}]}>{value}</Text>
      {sub && <Text style={styles.statusCardSub}>{sub}</Text>}
    </View>
  );
}

function CounterCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <View style={[styles.counterCard, {borderTopColor: color}]}>
      <Text style={[styles.counterValue, {color}]}>{count}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'connected': return '#28a745';
    case 'connecting':
    case 'scanning': return '#fd7e14';
    case 'error': return '#dc3545';
    default: return '#6c757d';
  }
}

function logTextStyle(level: LogEntry['level']) {
  switch (level) {
    case 'error': return {color: '#dc3545'};
    case 'warn': return {color: '#fd7e14'};
    default: return {color: '#333'};
  }
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#f5f5f5'},
  title: {fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#222'},

  statusGrid: {flexDirection: 'row', gap: 10, marginBottom: 12},
  statusCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusCardLabel: {fontSize: 12, color: '#888', textTransform: 'uppercase', fontWeight: '600'},
  statusCardValue: {fontSize: 16, fontWeight: '700', marginTop: 2},
  statusCardSub: {fontSize: 11, color: '#aaa', marginTop: 2},

  counterRow: {flexDirection: 'row', gap: 10, marginBottom: 16},
  counterCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderTopWidth: 3,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  counterValue: {fontSize: 28, fontWeight: '700'},
  counterLabel: {fontSize: 12, color: '#888', marginTop: 4, textAlign: 'center'},

  bridgeBtn: {
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  bridgeBtnStart: {backgroundColor: '#007bff'},
  bridgeBtnStop: {backgroundColor: '#dc3545'},
  bridgeBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  logTitle: {fontSize: 15, fontWeight: '700', color: '#333'},
  clearBtn: {paddingHorizontal: 10, paddingVertical: 4},
  clearBtnText: {color: '#007bff', fontSize: 13},

  logList: {flex: 1, backgroundColor: '#1e1e1e', borderRadius: 8},
  logContent: {padding: 8},
  logRow: {flexDirection: 'row', marginBottom: 3},
  logTime: {color: '#888', fontSize: 11, width: 90, fontFamily: 'monospace'},
  logMsg: {flex: 1, fontSize: 12, fontFamily: 'monospace'},
  logEmpty: {color: '#666', textAlign: 'center', marginTop: 20, fontStyle: 'italic'},
});
