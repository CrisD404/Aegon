import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Building2,
  Cable,
  Cloud,
  Cpu,
  Globe,
  Layers,
  LockKeyhole,
  MapPin,
  MonitorSmartphone,
  Network,
  Router,
  Server,
  ServerCog,
  Shield,
  ShieldCheck,
  Split,
  Waypoints,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { NODE_PROVIDER_CATALOG, type InfraType, type NodeType } from '@aegon/core';

/** Ícono de cada tipo de nodo de despliegue. */
export const NODE_TYPE_ICON: Readonly<Record<NodeType, LucideIcon>> = {
  datacenter: Building2,
  cloud: Cloud,
  region: MapPin,
  zone: MapPin,
  network: Network,
  subnet: Network,
  cluster: Boxes,
  namespace: Layers,
  server: Server,
  vm: ServerCog,
  runtime: Cpu,
  device: MonitorSmartphone,
  other: Server,
};

/** Ícono de cada tipo de infraestructura. */
export const INFRA_TYPE_ICON: Readonly<Record<InfraType, LucideIcon>> = {
  firewall: Shield,
  'load-balancer': Split,
  dns: Globe,
  gateway: Workflow,
  ingress: ArrowDownToLine,
  egress: ArrowUpFromLine,
  nat: ArrowUpFromLine,
  vpn: LockKeyhole,
  link: Cable,
  'security-group': ShieldCheck,
  waf: Shield,
  cdn: Globe,
  proxy: Waypoints,
  router: Router,
  other: Network,
};

/** Proveedor con color propio en el lienzo (el resto usa el neutro de los nodos). */
const COLORED_PROVIDERS = new Set(['aws', 'gcp', 'azure', 'onprem', 'openshift', 'kubernetes']);

export function providerTone(provider: string | undefined): string | undefined {
  return provider && COLORED_PROVIDERS.has(provider) ? provider : undefined;
}

export function nodeProvider(provider: string | undefined) {
  return provider ? NODE_PROVIDER_CATALOG.find((p) => p.id === provider) : undefined;
}
