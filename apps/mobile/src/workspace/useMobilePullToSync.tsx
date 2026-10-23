import { useContext } from 'react'
import { RefreshControl } from 'react-native'
import { MobileVaultControlsContext } from './MobileVaultContext'
import { mobilePullToSyncProps } from './mobilePullToSync'

export function useMobilePullToSync() {
  const controls = useContext(MobileVaultControlsContext)
  const props = mobilePullToSyncProps(controls)
  return props ? <RefreshControl {...props} /> : undefined
}
