/**
 * MulticastSettings.tsx
 *
 * UI for configuring the UDP multicast group IP and port.
 * Changes are persisted to global app state.
 */

import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import {useAppState, makeLog} from '../store/AppState';

interface Props {
  onSettingsChanged?: (group: string, port: number) => void;
}

/** Validate IPv4 multicast address (224.0.0.0 – 239.255.255.255) */
function isValidMulticastAddress(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) {return false;}
  const nums = parts.map(Number);
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) {return false;}
  // First octet must be 224–239
  return nums[0] >= 224 && nums[0] <= 239;
}

/** Validate UDP port (1–65535) */
function isValidPort(portStr: string): boolean {
  const p = Number(portStr);
  return Number.isInteger(p) && p >= 1 && p <= 65535;
}

export default function MulticastSettings({onSettingsChanged}: Props) {
  const {state, dispatch} = useAppState();

  const [groupInput, setGroupInput] = useState(state.multicastGroup);
  const [portInput, setPortInput] = useState(String(state.multicastPort));
  const [saved, setSaved] = useState(false);

  function saveSettings() {
    if (!isValidMulticastAddress(groupInput)) {
      Alert.alert(
        'Invalid Address',
        'Please enter a valid IPv4 multicast address (224.0.0.0 – 239.255.255.255).',
      );
      return;
    }
    if (!isValidPort(portInput)) {
      Alert.alert('Invalid Port', 'Please enter a valid port number (1–65535).');
      return;
    }

    const port = Number(portInput);
    dispatch({type: 'SET_MULTICAST_GROUP', group: groupInput});
    dispatch({type: 'SET_MULTICAST_PORT', port});
    dispatch({
      type: 'ADD_LOG',
      entry: makeLog(`Multicast settings updated: ${groupInput}:${port}`),
    });

    onSettingsChanged?.(groupInput, port);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function resetDefaults() {
    const defaultGroup = '224.0.0.251';
    const defaultPort = 5353;
    setGroupInput(defaultGroup);
    setPortInput(String(defaultPort));
    dispatch({type: 'SET_MULTICAST_GROUP', group: defaultGroup});
    dispatch({type: 'SET_MULTICAST_PORT', port: defaultPort});
    dispatch({
      type: 'ADD_LOG',
      entry: makeLog('Multicast settings reset to defaults.'),
    });
    onSettingsChanged?.(defaultGroup, defaultPort);
  }

  const groupValid = isValidMulticastAddress(groupInput);
  const portValid = isValidPort(portInput);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Multicast Settings</Text>

      {/* Current status badge */}
      <View
        style={[
          styles.statusBadge,
          state.multicastActive ? styles.statusActive : styles.statusInactive,
        ]}>
        <Text style={styles.statusText}>
          {state.multicastActive
            ? `Active: ${state.multicastGroup}:${state.multicastPort}`
            : 'Multicast Inactive'}
        </Text>
      </View>

      {/* Multicast Group */}
      <Text style={styles.label}>Multicast Group Address</Text>
      <TextInput
        style={[styles.input, !groupValid && groupInput.length > 0 && styles.inputError]}
        value={groupInput}
        onChangeText={v => {
          setGroupInput(v);
          setSaved(false);
        }}
        placeholder="224.0.0.251"
        placeholderTextColor="#aaa"
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!groupValid && groupInput.length > 0 && (
        <Text style={styles.errorText}>
          Must be a valid multicast address (224.x.x.x – 239.x.x.x)
        </Text>
      )}

      {/* Port */}
      <Text style={styles.label}>Port</Text>
      <TextInput
        style={[styles.input, !portValid && portInput.length > 0 && styles.inputError]}
        value={portInput}
        onChangeText={v => {
          setPortInput(v);
          setSaved(false);
        }}
        placeholder="5353"
        placeholderTextColor="#aaa"
        keyboardType="number-pad"
      />
      {!portValid && portInput.length > 0 && (
        <Text style={styles.errorText}>Must be a valid port (1–65535)</Text>
      )}

      {/* Well-known presets */}
      <Text style={styles.sectionLabel}>Presets</Text>
      <View style={styles.presetRow}>
        {PRESETS.map(p => (
          <TouchableOpacity
            key={p.label}
            style={styles.presetBtn}
            onPress={() => {
              setGroupInput(p.group);
              setPortInput(String(p.port));
              setSaved(false);
            }}>
            <Text style={styles.presetLabel}>{p.label}</Text>
            <Text style={styles.presetDetail}>
              {p.group}:{p.port}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.saveBtn, (!groupValid || !portValid) && styles.saveBtnDisabled]}
          onPress={saveSettings}
          disabled={!groupValid || !portValid}>
          <Text style={styles.saveBtnText}>
            {saved ? '✓ Saved' : 'Apply Settings'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.resetBtn} onPress={resetDefaults}>
          <Text style={styles.resetBtnText}>Reset Defaults</Text>
        </TouchableOpacity>
      </View>

      {/* Info box */}
      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>About Multicast Bridge</Text>
        <Text style={styles.infoText}>
          This app subscribes to the specified multicast group on all network
          interfaces. Packets received from the multicast group are forwarded to
          the connected Meshtastic node via BLE, and packets received from the
          Meshtastic node are broadcast to the multicast group.
        </Text>
      </View>
    </ScrollView>
  );
}

const PRESETS = [
  {label: 'mDNS', group: '224.0.0.251', port: 5353},
  {label: 'SSDP', group: '239.255.255.250', port: 1900},
  {label: 'Custom', group: '239.0.0.1', port: 4403},
];

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#f5f5f5'},
  content: {padding: 16, paddingBottom: 40},
  title: {fontSize: 20, fontWeight: '700', marginBottom: 16, color: '#222'},
  statusBadge: {
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
    alignItems: 'center',
  },
  statusActive: {backgroundColor: '#d4edda'},
  statusInactive: {backgroundColor: '#f8d7da'},
  statusText: {fontWeight: '600', fontSize: 14},
  label: {fontSize: 14, fontWeight: '600', color: '#444', marginBottom: 6, marginTop: 12},
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#222',
  },
  inputError: {borderColor: '#dc3545'},
  errorText: {color: '#dc3545', fontSize: 12, marginTop: 4},
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    marginTop: 20,
    marginBottom: 8,
  },
  presetRow: {flexDirection: 'row', gap: 8},
  presetBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  presetLabel: {fontSize: 13, fontWeight: '600', color: '#333'},
  presetDetail: {fontSize: 11, color: '#777', marginTop: 2},
  buttonRow: {flexDirection: 'row', gap: 10, marginTop: 24},
  saveBtn: {
    flex: 2,
    backgroundColor: '#28a745',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnDisabled: {backgroundColor: '#aaa'},
  saveBtnText: {color: '#fff', fontSize: 15, fontWeight: '700'},
  resetBtn: {
    flex: 1,
    backgroundColor: '#6c757d',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetBtnText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  infoBox: {
    backgroundColor: '#e9f4ff',
    borderRadius: 8,
    padding: 14,
    marginTop: 28,
  },
  infoTitle: {fontSize: 14, fontWeight: '700', color: '#1a5276', marginBottom: 6},
  infoText: {fontSize: 13, color: '#2c3e50', lineHeight: 20},
});
