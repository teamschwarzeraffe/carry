const DC = require('discovery-channel')

export interface DiscoveryServer {
  close()
}

interface DiscoveryInfo {
  GCI: string
  rpcPort: number
}

export default function(info: DiscoveryInfo): DiscoveryServer {
  const channel = DC()
  channel.join(info.GCI, info.rpcPort)
  return {
    close() {
      channel.destroy()
    }
  }
}
