/**
 * ============================================================================
 * JARVIS COCKPIT — LoRa SX1278 PROTOCOL PARSER & VALIDATOR
 * ============================================================================
 * Handles packet verification, CRC check, sequence tracking,
 * and diagnostic state classification for the SX1278 transceiver.
 * ============================================================================
 */

export class LoRaProtocol {
  static STATUS_NAMES = {
    0: 'OFFLINE',
    1: 'INITIALIZING',
    2: 'ONLINE',
    3: 'TRANSMITTING',
    4: 'ACKNOWLEDGED',
    5: 'RETRYING',
    6: 'ERROR'
  };

  static parsePacket(rawString) {
    if (!rawString || typeof rawString !== 'string') return null;

    const parts = rawString.split('|');
    const result = {
      isValid: false,
      header: parts[0] || '',
      deviceId: '',
      sequence: 0,
      timestamp: 0,
      peakG: 0.0,
      roll: 0.0,
      pitch: 0.0,
      gps: null,
      temp: null,
      crcValid: false
    };

    if (result.header === 'JARVIS_EMERGENCY' || result.header === 'ACK_EMERGENCY') {
      for (const part of parts) {
        if (part.startsWith('DEV:')) result.deviceId = part.substring(4);
        else if (part.startsWith('SEQ:')) result.sequence = parseInt(part.substring(4));
        else if (part.startsWith('TIME:')) result.timestamp = parseInt(part.substring(5));
        else if (part.startsWith('G_FORCE:')) result.peakG = parseFloat(part.substring(8));
        else if (part.startsWith('ROLL:')) result.roll = parseFloat(part.substring(5));
        else if (part.startsWith('PITCH:')) result.pitch = parseFloat(part.substring(6));
        else if (part.startsWith('GPS:')) result.gps = part.substring(4);
        else if (part.startsWith('TEMP:')) result.temp = parseFloat(part.substring(5));
        else if (part === 'CRC:OK') result.crcValid = true;
      }
      result.isValid = result.crcValid && result.deviceId.length > 0;
    }

    return result;
  }

  static getStatusLabel(statusCode) {
    return this.STATUS_NAMES[statusCode] || 'UNKNOWN';
  }

  static getRssiQuality(rssi) {
    if (rssi === 0 || !rssi) return { label: 'NO SIGNAL', color: '#4B5563', percent: 0 };
    if (rssi >= -65) return { label: 'EXCELLENT', color: '#00F0FF', percent: 100 };
    if (rssi >= -85) return { label: 'GOOD', color: '#10B981', percent: 75 };
    if (rssi >= -105) return { label: 'FAIR', color: '#F59E0B', percent: 45 };
    return { label: 'WEAK / MARGINAL', color: '#EF4444', percent: 20 };
  }
}

