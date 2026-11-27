import { describe, expect, it } from 'vitest';
import { edgeLabelParts, edgeLabelSize, edgeLabelSizes } from '../layout/elk.ts';
import { invertRelationPatch } from '../ops/commands.ts';
import type { Relation } from '../schema/index.ts';
import { Relation as RelationSchema } from '../schema/index.ts';
import {
  channelFields,
  findProtocol,
  protocolIds,
  relationBack,
  relationBackWith,
  relationChannels,
  relationPorts,
  relationTechLines,
  relationTechnology,
  relationTechnologyBothWays,
  relationUsage,
} from './index.ts';

const rel = (fields: Partial<Relation>): Relation => ({ id: 'a--b', from: 'a', to: 'b', ...fields });

describe('protocolos con sus puertos', () => {
  it('el formato acepta el ID solo o el ID con sus puertos', () => {
    const ok = RelationSchema.safeParse(rel({ protocols: ['https', { id: 'dns', ports: [53] }], ports: [8080] }));
    expect(ok.success).toBe(true);
    // Un protocolo con la lista de puertos vacía no dice nada: se escribe el ID solo.
    expect(RelationSchema.safeParse(rel({ protocols: [{ id: 'dns', ports: [] }] })).success).toBe(false);
    expect(RelationSchema.safeParse(rel({ protocols: [{ id: 'dns', ports: [70000] }] })).success).toBe(false);
  });

  it('cada protocolo queda con los puertos que se le declararon', () => {
    const r = rel({ protocols: [{ id: 'dns', ports: [53] }, { id: 'ntp', ports: [123] }, { id: 'ldap', ports: [389, 636] }] });
    expect(relationChannels(r)).toEqual([
      { id: 'dns', ports: [53] },
      { id: 'ntp', ports: [123] },
      { id: 'ldap', ports: [389, 636] },
    ]);
    expect(relationTechLines(r)).toEqual(['DNS :53', 'NTP :123', 'LDAP :389, :636']);
    expect(relationTechnology(r)).toBe('DNS :53 · NTP :123 · LDAP :389, :636');
    expect(protocolIds(r)).toEqual(['dns', 'ntp', 'ldap']);
    expect(relationPorts(r)).toEqual([53, 123, 389, 636]);
  });

  it('lo que ya estaba cargado se lee igual que antes cuando no hay duda', () => {
    // Un solo protocolo: los puertos sueltos son suyos.
    expect(relationTechnology(rel({ protocols: ['https'], ports: [443, 80] }))).toBe('HTTPS :443, :80');
    // Sin puertos: todos los protocolos en un renglón.
    expect(relationTechLines(rel({ protocols: ['rest', 'https'] }))).toEqual(['REST/JSON, HTTPS']);
    // Solo puertos.
    expect(relationTechnology(rel({ ports: [1433] }))).toBe(':1433');
    expect(relationTechnology(rel({}))).toBe('');
  });

  it('con varios protocolos, un puerto suelto va con el que lo usa habitualmente', () => {
    const r = rel({ protocols: ['dns', 'ntp', 'ldap'], ports: [123, 53, 8443] });
    expect(relationChannels(r)).toEqual([
      { id: 'dns', ports: [53] },
      { id: 'ntp', ports: [123] },
      { id: 'ldap', ports: [] },
      { ports: [8443] },
    ]);
    // Los que quedan sin puerto van juntos y primero; lo que no se pudo asignar, al final y sin nombre.
    expect(relationTechLines(r)).toEqual(['LDAP', 'DNS :53', 'NTP :123', ':8443']);
  });

  it('un puerto declarado no se pisa con uno suelto', () => {
    const r = rel({ protocols: [{ id: 'https', ports: [8443] }, 'ssh'], ports: [443, 22] });
    expect(relationChannels(r)).toEqual([
      { id: 'https', ports: [8443] },
      { id: 'ssh', ports: [22] },
      { ports: [443] },
    ]);
  });

  it('los canales vuelven a los campos del formato sin perder nada', () => {
    const channels = [{ id: 'https', ports: [] }, { id: 'dns', ports: [53, 53] }, { ports: [8080] }];
    expect(channelFields(channels)).toEqual({ protocols: ['https', { id: 'dns', ports: [53] }], ports: [8080] });
    expect(channelFields([])).toEqual({ protocols: null, ports: null });
    // Ida y vuelta: lo declarado se lee igual.
    const fields = channelFields([{ id: 'dns', ports: [53] }, { id: 'ntp', ports: [123] }]);
    expect(relationChannels(rel({ protocols: fields.protocols!, ports: fields.ports ?? undefined }))).toEqual([
      { id: 'dns', ports: [53] },
      { id: 'ntp', ports: [123] },
    ]);
  });

  it('el catálogo conoce el puerto habitual de los protocolos de red', () => {
    expect(findProtocol('dns')?.port).toBe(53);
    expect(findProtocol('ntp')?.port).toBe(123);
    expect(findProtocol('ldap')?.port).toBe(389);
    expect(findProtocol('https')?.port).toBe(443);
    expect(findProtocol('grpc')?.port).toBeUndefined();
  });

  it('la etiqueta de la flecha lleva un renglón por protocolo y resume cuando son muchos', () => {
    const three = rel({ label: 'Autentica y sincroniza', protocols: [{ id: 'dns', ports: [53] }, { id: 'ntp', ports: [123] }, { id: 'ldap', ports: [389] }] });
    const parts = edgeLabelParts({ relations: [three], implied: false });
    expect(parts.techLines).toEqual(['DNS :53', 'NTP :123', 'LDAP :389']);
    expect(parts.tech).toBe('DNS :53 · NTP :123 · LDAP :389');
    // Cada renglón suma alto a la etiqueta (para que el lienzo le deje lugar).
    const one = edgeLabelSize({ relations: [rel({ label: 'Autentica y sincroniza', protocols: [{ id: 'dns', ports: [53] }] })], implied: false })!;
    expect(edgeLabelSize({ relations: [three], implied: false })!.height).toBeGreaterThan(one.height);

    const many = rel({ protocols: ['dns', 'ntp', 'ldap', 'kerberos', 'smb', 'rdp'].map((id) => ({ id, ports: [findProtocol(id)!.port!] })) });
    expect(edgeLabelParts({ relations: [many], implied: false }).techLines).toEqual(['DNS :53', 'NTP :123', 'LDAP :389', '+3 más']);
    expect(edgeLabelParts({ relations: [many], implied: true }).techLines).toEqual([]);
  });
});

describe('ida y vuelta: cada sentido con lo suyo', () => {
  const twoWay = rel({
    label: 'Autentica',
    protocols: [{ id: 'ldap', ports: [389] }],
    direction: 'bidirectional',
    back: { label: 'Replica perfiles', protocols: [{ id: 'smb', ports: [445] }] },
  });

  it('el formato acepta la vuelta con su etiqueta y sus protocolos', () => {
    expect(RelationSchema.safeParse(twoWay).success).toBe(true);
    expect(RelationSchema.safeParse(rel({ back: { protocols: [{ id: 'smb', ports: [] }] } })).success).toBe(false);
  });

  it('la vuelta cuenta solo en una relación bidireccional y si declara algo', () => {
    expect(relationBack(twoWay)).toEqual({ label: 'Replica perfiles', protocols: [{ id: 'smb', ports: [445] }] });
    expect(relationBack({ ...twoWay, direction: undefined })).toBeUndefined();
    expect(relationBack(rel({ direction: 'bidirectional', back: {} }))).toBeUndefined();
    expect(relationBack(rel({ direction: 'bidirectional' }))).toBeUndefined();
  });

  it('la vuelta se arma por partes y desaparece cuando queda vacía', () => {
    const withProtocols = relationBackWith(undefined, { protocols: ['smb'] });
    expect(withProtocols).toEqual({ protocols: ['smb'] });
    const labelled = relationBackWith(withProtocols!, { label: 'Replica' });
    expect(labelled).toEqual({ protocols: ['smb'], label: 'Replica' });
    expect(relationBackWith(labelled!, { protocols: null })).toEqual({ label: 'Replica' });
    expect(relationBackWith({ label: 'Replica' }, { label: null })).toBeNull();
  });

  it('la etiqueta de la flecha trae cada sentido por separado', () => {
    const parts = edgeLabelParts({ relations: [twoWay], implied: false });
    expect(parts).toMatchObject({ label: 'Autentica', techLines: ['LDAP :389'] });
    expect(parts.back).toEqual({ label: 'Replica perfiles', tech: 'SMB/CIFS :445', techLines: ['SMB/CIFS :445'] });
    // De un solo sentido, o agrupada con otras, no hay vuelta que mostrar.
    expect(edgeLabelParts({ relations: [{ ...twoWay, direction: undefined }], implied: false }).back).toBeUndefined();
    expect(edgeLabelParts({ relations: [twoWay, rel({ id: 'c--d' })], implied: true }).back).toBeUndefined();
    // Cada lado suma su flechita; apiladas ocupan el alto de las dos.
    const sides = edgeLabelSizes({ relations: [twoWay], implied: false });
    const plain = edgeLabelSize({ relations: [{ ...twoWay, direction: undefined }], implied: false })!;
    expect(sides.main!.width).toBeGreaterThan(plain.width);
    expect(edgeLabelSize({ relations: [twoWay], implied: false })!.height).toBeGreaterThan(Math.max(sides.main!.height, sides.back!.height));
  });

  it('los chequeos y lo que se exporta miran los dos sentidos', () => {
    expect(relationUsage(twoWay)).toEqual({ protocols: ['ldap', 'smb'], ports: [389, 445] });
    expect(relationTechnologyBothWays(twoWay)).toBe('LDAP :389 · ← SMB/CIFS :445');
    expect(relationTechnologyBothWays(rel({ protocols: ['https'] }))).toBe('HTTPS');
  });

  it('invertir la relación intercambia la ida y la vuelta', () => {
    expect(invertRelationPatch(twoWay)).toEqual({
      from: 'b',
      to: 'a',
      label: 'Replica perfiles',
      protocols: [{ id: 'smb', ports: [445] }],
      ports: null,
      back: { label: 'Autentica', protocols: [{ id: 'ldap', ports: [389] }] },
    });
    expect(invertRelationPatch(rel({ label: 'Lee' }))).toEqual({ from: 'b', to: 'a' });
  });
});
