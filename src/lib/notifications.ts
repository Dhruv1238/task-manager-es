import { updateDoc } from 'firebase/firestore'
import { tenantDoc } from './firestore'

// Per-user notification opt-outs, written with the same dot-path merge pattern
// as markChatRead so only the one key is touched. Missing key = opted in.
export type NotificationPrefKey =
  | 'mention'
  | 'assignment'
  | 'statusUpdate'
  | 'roleAssignment'

export async function setNotificationPref(
  uid: string,
  key: NotificationPrefKey,
  enabled: boolean,
): Promise<void> {
  await updateDoc(tenantDoc('users', uid), { [`notificationPrefs.${key}`]: enabled })
}
