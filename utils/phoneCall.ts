import { Linking, AppState, AppStateStatus } from 'react-native';
import { phoneCallsApi } from '../services/api/phoneCalls';

interface MakeCallOptions {
  phoneNumber: string;
  organization: string;
  callerUserId?: string;
  callerUserName?: string;
  relatedTo?: {
    type: 'contact' | 'lead' | 'case';
    entityId: string;
    entityName?: string;
  };
  contactName?: string;
}

export interface GambotCallOptions {
  phoneNumber: string;
  organization: string;
  agentPhone: string;
  fromPhoneNumber: string;
  agentId: string;
  agentName: string;
  customerName?: string;
  notes?: string;
}

export interface GambotCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

let lastAppCall: { callId: string; organization: string; startTime: number } | null = null;

function handleAppStateChange(nextState: AppStateStatus) {
  if (nextState === 'active' && lastAppCall) {
    const durationSec = Math.round((Date.now() - lastAppCall.startTime) / 1000);
    phoneCallsApi
      .updateAppCall(lastAppCall.organization, lastAppCall.callId, {
        status: 'completed',
        duration: `${durationSec}`,
      })
      .catch(() => {});
    lastAppCall = null;
  }
}

let appStateListener: { remove: () => void } | null = null;

export async function makeAppCall(options: MakeCallOptions): Promise<{ callId?: string } | void> {
  const { phoneNumber, organization, callerUserId, callerUserName, relatedTo, contactName } = options;

  if (!phoneNumber) return;

  try {
    const result = await phoneCallsApi.createAppCall(organization, {
      phoneNumber,
      contactName,
      direction: 'outbound' as any,
      status: 'initiated' as any,
      calledBy: callerUserId,
      calledByName: callerUserName,
      relatedTo: relatedTo as any,
      startTime: new Date().toISOString(),
      source: 'mobile_app',
    } as any);

    const callId = result?.callId || result?.id;
    if (callId) {
      lastAppCall = { callId, organization, startTime: Date.now() };
      if (!appStateListener) {
        appStateListener = AppState.addEventListener('change', handleAppStateChange);
      }
    }
  } catch {
    // Don't block calling if logging fails
  }

  await Linking.openURL(`tel:${phoneNumber}`);
}

/**
 * Place a Gambot-routed call via Telnyx.
 * Flow: Telnyx calls the agent's phone → agent answers → Telnyx bridges to customer.
 * Call is recorded and logged in CRM automatically.
 */
export async function makeGambotCall(options: GambotCallOptions): Promise<GambotCallResult> {
  const { phoneNumber, organization, agentPhone, fromPhoneNumber, agentId, agentName, customerName, notes } = options;

  if (!phoneNumber || !agentPhone || !fromPhoneNumber) {
    return { success: false, error: 'missing_fields' };
  }

  try {
    const result = await phoneCallsApi.gambotOutboundCall({
      organizationName: organization,
      phoneNumber,
      fromPhoneNumber,
      agentPhone,
      agentIdentity: fromPhoneNumber,
      agentId,
      agentName,
      customerName,
      notes,
    });

    return {
      success: !!result.success,
      callId: result.callId,
      error: result.success ? undefined : 'call_failed',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'network_error' };
  }
}
