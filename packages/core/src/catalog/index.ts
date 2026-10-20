import type {
  BusType,
  ContainerType,
  Element,
  ElementKind,
  GroupProvider,
  InfraType,
  NodeType,
  Risk,
  Status,
  StoreType,
} from '../schema/index.ts';

/**
 * Catálogos de la UI. `icon` es una clave del registro de `@aegon/icons` (slug de simple-icons
 * o un glifo propio); si la marca no existe, el registro dibuja un monograma con el mismo estilo.
 *
 * Cada cosa va en su catálogo: las tecnologías son lenguajes, frameworks y plataformas de
 * sistemas/contenedores/componentes; una base de datos se describe por su motor, un bus por su
 * broker y una relación por sus protocolos.
 */

export interface CatalogItem {
  id: string;
  name: string;
  icon: string;
  /** Palabras extra para la búsqueda. */
  keywords?: string[];
}

// -----------------------------------------------------------------------------------------------
// Motores de base de datos

export interface DbEngine extends CatalogItem {
  type: StoreType;
}

export const DB_ENGINES: readonly DbEngine[] = [
  { id: 'postgresql', name: 'PostgreSQL', icon: 'postgresql', type: 'relational', keywords: ['postgres', 'pg'] },
  { id: 'mysql', name: 'MySQL', icon: 'mysql', type: 'relational' },
  { id: 'mariadb', name: 'MariaDB', icon: 'mariadb', type: 'relational' },
  { id: 'sqlserver', name: 'SQL Server', icon: 'microsoftsqlserver', type: 'relational', keywords: ['mssql'] },
  { id: 'oracle', name: 'Oracle Database', icon: 'oracle', type: 'relational' },
  { id: 'db2', name: 'IBM Db2', icon: 'ibm', type: 'relational' },
  { id: 'sqlite', name: 'SQLite', icon: 'sqlite', type: 'relational' },
  { id: 'aurora', name: 'Amazon Aurora', icon: 'amazonrds', type: 'relational', keywords: ['rds', 'aws'] },
  { id: 'cloudsql', name: 'Cloud SQL', icon: 'googlecloud', type: 'relational', keywords: ['gcp'] },
  { id: 'cockroachdb', name: 'CockroachDB', icon: 'cockroachlabs', type: 'relational' },
  { id: 'mongodb', name: 'MongoDB', icon: 'mongodb', type: 'document', keywords: ['mongo'] },
  { id: 'couchbase', name: 'Couchbase', icon: 'couchbase', type: 'document' },
  { id: 'firestore', name: 'Firestore', icon: 'firebase', type: 'document', keywords: ['firebase'] },
  { id: 'cosmosdb', name: 'Cosmos DB', icon: 'azurecosmosdb', type: 'document', keywords: ['azure'] },
  { id: 'dynamodb', name: 'DynamoDB', icon: 'amazondynamodb', type: 'key-value', keywords: ['aws', 'dynamo'] },
  { id: 'cassandra', name: 'Cassandra', icon: 'apachecassandra', type: 'key-value' },
  { id: 'redis', name: 'Redis', icon: 'redis', type: 'cache' },
  { id: 'memcached', name: 'Memcached', icon: 'memcached', type: 'cache' },
  { id: 'elasticsearch', name: 'Elasticsearch', icon: 'elasticsearch', type: 'search', keywords: ['elastic'] },
  { id: 'opensearch', name: 'OpenSearch', icon: 'opensearch', type: 'search' },
  { id: 's3', name: 'Amazon S3', icon: 'amazons3', type: 'object', keywords: ['aws', 'bucket'] },
  { id: 'gcs', name: 'Cloud Storage', icon: 'googlecloudstorage', type: 'object', keywords: ['gcp', 'bucket'] },
  { id: 'blob', name: 'Azure Blob Storage', icon: 'microsoftazure', type: 'object', keywords: ['azure'] },
  { id: 'neo4j', name: 'Neo4j', icon: 'neo4j', type: 'graph' },
  { id: 'influxdb', name: 'InfluxDB', icon: 'influxdb', type: 'time-series' },
  { id: 'timescaledb', name: 'TimescaleDB', icon: 'timescale', type: 'time-series' },
  { id: 'snowflake', name: 'Snowflake', icon: 'snowflake', type: 'warehouse' },
  { id: 'bigquery', name: 'BigQuery', icon: 'googlebigquery', type: 'warehouse', keywords: ['gcp'] },
  { id: 'redshift', name: 'Amazon Redshift', icon: 'amazonredshift', type: 'warehouse', keywords: ['aws'] },
  { id: 'clickhouse', name: 'ClickHouse', icon: 'clickhouse', type: 'warehouse' },
];

export const OTHER_ENGINE = 'other';

// -----------------------------------------------------------------------------------------------
// Brokers de mensajería (elementos `bus`)

export interface MessageBroker extends CatalogItem {
  type: BusType;
  /** Protocolo nativo (ID de PROTOCOLS) para sugerirlo en las relaciones hacia el bus. */
  protocol: string;
}

export const MESSAGE_BROKERS: readonly MessageBroker[] = [
  { id: 'kafka', name: 'Apache Kafka', icon: 'apachekafka', type: 'stream', protocol: 'kafka', keywords: ['confluent', 'msk'] },
  { id: 'rabbitmq', name: 'RabbitMQ', icon: 'rabbitmq', type: 'queue', protocol: 'amqp' },
  { id: 'activemq', name: 'ActiveMQ', icon: 'apacheactivemq', type: 'queue', protocol: 'jms', keywords: ['artemis'] },
  { id: 'pulsar', name: 'Apache Pulsar', icon: 'apachepulsar', type: 'stream', protocol: 'pulsar' },
  { id: 'nats', name: 'NATS', icon: 'natsdotio', type: 'topic', protocol: 'nats', keywords: ['jetstream'] },
  { id: 'redis-streams', name: 'Redis Streams', icon: 'redis', type: 'stream', protocol: 'resp' },
  { id: 'mosquitto', name: 'MQTT (Mosquitto)', icon: 'eclipsemosquitto', type: 'topic', protocol: 'mqtt', keywords: ['iot'] },
  { id: 'ibm-mq', name: 'IBM MQ', icon: 'ibm', type: 'queue', protocol: 'jms', keywords: ['websphere'] },
  { id: 'sqs', name: 'Amazon SQS', icon: 'amazonsqs', type: 'queue', protocol: 'https', keywords: ['aws'] },
  { id: 'sns', name: 'Amazon SNS', icon: 'amazonsns', type: 'topic', protocol: 'https', keywords: ['aws'] },
  { id: 'eventbridge', name: 'Amazon EventBridge', icon: 'amazoneventbridge', type: 'event-bus', protocol: 'https', keywords: ['aws'] },
  { id: 'kinesis', name: 'Amazon Kinesis', icon: 'amazonkinesis', type: 'stream', protocol: 'https', keywords: ['aws'] },
  { id: 'pubsub', name: 'Google Pub/Sub', icon: 'googlepubsub', type: 'topic', protocol: 'grpc', keywords: ['gcp'] },
  { id: 'service-bus', name: 'Azure Service Bus', icon: 'azureservicebus', type: 'queue', protocol: 'amqp', keywords: ['azure'] },
  { id: 'event-hubs', name: 'Azure Event Hubs', icon: 'azureeventhubs', type: 'stream', protocol: 'kafka', keywords: ['azure'] },
];

export const OTHER_BROKER = 'other';

// -----------------------------------------------------------------------------------------------
// Tecnologías de sistemas, contenedores y componentes

export type TechCategory = 'language' | 'backend' | 'frontend' | 'mobile' | 'platform' | 'infrastructure' | 'saas';

export interface Technology extends CatalogItem {
  category: TechCategory;
}

export const TECH_CATEGORY_LABEL: Readonly<Record<TechCategory, string>> = {
  language: 'Lenguajes',
  backend: 'Frameworks backend',
  frontend: 'Frontend',
  mobile: 'Mobile',
  platform: 'Plataforma',
  infrastructure: 'Infraestructura y redes',
  saas: 'Productos',
};

export const TECHNOLOGIES: readonly Technology[] = [
  { id: 'java', name: 'Java', icon: 'openjdk', category: 'language' },
  { id: 'kotlin', name: 'Kotlin', icon: 'kotlin', category: 'language' },
  { id: 'typescript', name: 'TypeScript', icon: 'typescript', category: 'language', keywords: ['ts'] },
  { id: 'javascript', name: 'JavaScript', icon: 'javascript', category: 'language', keywords: ['js'] },
  { id: 'python', name: 'Python', icon: 'python', category: 'language' },
  { id: 'go', name: 'Go', icon: 'go', category: 'language', keywords: ['golang'] },
  { id: 'dotnet', name: '.NET', icon: 'dotnet', category: 'language', keywords: ['csharp', 'c#'] },
  { id: 'php', name: 'PHP', icon: 'php', category: 'language' },
  { id: 'ruby', name: 'Ruby', icon: 'ruby', category: 'language' },
  { id: 'rust', name: 'Rust', icon: 'rust', category: 'language' },
  { id: 'scala', name: 'Scala', icon: 'scala', category: 'language' },
  { id: 'swift', name: 'Swift', icon: 'swift', category: 'language' },
  { id: 'dart', name: 'Dart', icon: 'dart', category: 'language' },
  { id: 'elixir', name: 'Elixir', icon: 'elixir', category: 'language' },
  { id: 'spring-boot', name: 'Spring Boot', icon: 'springboot', category: 'backend', keywords: ['spring'] },
  { id: 'quarkus', name: 'Quarkus', icon: 'quarkus', category: 'backend' },
  { id: 'nodejs', name: 'Node.js', icon: 'nodedotjs', category: 'backend', keywords: ['node'] },
  { id: 'nestjs', name: 'NestJS', icon: 'nestjs', category: 'backend' },
  { id: 'express', name: 'Express', icon: 'express', category: 'backend' },
  { id: 'fastapi', name: 'FastAPI', icon: 'fastapi', category: 'backend' },
  { id: 'django', name: 'Django', icon: 'django', category: 'backend' },
  { id: 'flask', name: 'Flask', icon: 'flask', category: 'backend' },
  { id: 'laravel', name: 'Laravel', icon: 'laravel', category: 'backend' },
  { id: 'rails', name: 'Ruby on Rails', icon: 'rubyonrails', category: 'backend' },
  { id: 'react', name: 'React', icon: 'react', category: 'frontend' },
  { id: 'nextjs', name: 'Next.js', icon: 'nextdotjs', category: 'frontend' },
  { id: 'angular', name: 'Angular', icon: 'angular', category: 'frontend' },
  { id: 'vue', name: 'Vue', icon: 'vuedotjs', category: 'frontend' },
  { id: 'svelte', name: 'Svelte', icon: 'svelte', category: 'frontend' },
  { id: 'flutter', name: 'Flutter', icon: 'flutter', category: 'mobile' },
  { id: 'react-native', name: 'React Native', icon: 'react', category: 'mobile' },
  { id: 'android', name: 'Android', icon: 'android', category: 'mobile' },
  { id: 'ios', name: 'iOS', icon: 'apple', category: 'mobile' },
  { id: 'docker', name: 'Docker', icon: 'docker', category: 'platform' },
  { id: 'kubernetes', name: 'Kubernetes', icon: 'kubernetes', category: 'platform', keywords: ['k8s'] },
  { id: 'nginx', name: 'NGINX', icon: 'nginx', category: 'platform' },
  { id: 'apache', name: 'Apache HTTP', icon: 'apache', category: 'platform' },
  { id: 'kong', name: 'Kong', icon: 'kong', category: 'platform', keywords: ['gateway'] },
  { id: 'istio', name: 'Istio', icon: 'istio', category: 'platform' },
  { id: 'terraform', name: 'Terraform', icon: 'terraform', category: 'platform' },
  { id: 'aws-lambda', name: 'AWS Lambda', icon: 'awslambda', category: 'platform', keywords: ['lambda', 'serverless'] },
  { id: 'cloud-run', name: 'Cloud Run', icon: 'googlecloud', category: 'platform' },
  { id: 'cloud-functions', name: 'Cloud Functions', icon: 'googlecloud', category: 'platform' },
  { id: 'azure-functions', name: 'Azure Functions', icon: 'azurefunctions', category: 'platform' },
  { id: 'openshift', name: 'OpenShift', icon: 'redhatopenshift', category: 'platform', keywords: ['ocp', 'red hat', 'k8s'] },
  { id: 'rosa', name: 'Red Hat OpenShift on AWS', icon: 'redhatopenshift', category: 'platform', keywords: ['rosa', 'ocp', 'aws'] },
  { id: 'vmware', name: 'VMware vSphere', icon: 'vmware', category: 'platform', keywords: ['esxi', 'vm'] },
  { id: 'linux', name: 'Linux', icon: 'linux', category: 'platform', keywords: ['rhel', 'ubuntu'] },
  { id: 'windows-server', name: 'Windows Server', icon: 'glyph:server', category: 'platform', keywords: ['windows', 'iis'] },
  { id: 'aws-ec2', name: 'Amazon EC2', icon: 'glyph:server', category: 'infrastructure', keywords: ['aws', 'instancia', 'vm'] },
  { id: 'aws-vpc', name: 'Amazon VPC', icon: 'glyph:network', category: 'infrastructure', keywords: ['aws', 'red'] },
  { id: 'aws-alb', name: 'AWS Application Load Balancer', icon: 'glyph:network', category: 'infrastructure', keywords: ['alb', 'elb', 'load balancer', 'balanceador'] },
  { id: 'aws-nlb', name: 'AWS Network Load Balancer', icon: 'glyph:network', category: 'infrastructure', keywords: ['nlb', 'elb', 'load balancer', 'balanceador'] },
  { id: 'route53', name: 'Amazon Route 53', icon: 'glyph:network', category: 'infrastructure', keywords: ['route 53', 'dns', 'aws'] },
  { id: 'aws-direct-connect', name: 'AWS Direct Connect', icon: 'glyph:network', category: 'infrastructure', keywords: ['direct connect', 'dx', 'enlace', 'aws'] },
  { id: 'aws-security-group', name: 'AWS Security Group', icon: 'glyph:network', category: 'infrastructure', keywords: ['security group', 'sg', 'aws'] },
  { id: 'aws-nat-gateway', name: 'AWS NAT Gateway', icon: 'glyph:network', category: 'infrastructure', keywords: ['nat', 'egress', 'aws'] },
  { id: 'aws-api-gateway', name: 'Amazon API Gateway', icon: 'glyph:network', category: 'infrastructure', keywords: ['api gateway', 'aws'] },
  { id: 'cloudfront', name: 'Amazon CloudFront', icon: 'glyph:globe', category: 'infrastructure', keywords: ['cdn', 'aws'] },
  { id: 'aws-waf', name: 'AWS WAF', icon: 'glyph:network', category: 'infrastructure', keywords: ['waf', 'aws'] },
  { id: 'azure-front-door', name: 'Azure Front Door', icon: 'glyph:globe', category: 'infrastructure', keywords: ['cdn', 'waf', 'azure'] },
  { id: 'azure-apim', name: 'Azure API Management', icon: 'glyph:network', category: 'infrastructure', keywords: ['apim', 'api manager', 'azure'] },
  { id: 'fortigate', name: 'FortiGate', icon: 'fortinet', category: 'infrastructure', keywords: ['fortinet', 'firewall', 'fg'] },
  { id: 'palo-alto', name: 'Palo Alto NGFW', icon: 'paloaltonetworks', category: 'infrastructure', keywords: ['firewall'] },
  { id: 'cisco', name: 'Cisco', icon: 'cisco', category: 'infrastructure', keywords: ['router', 'switch', 'asa'] },
  { id: 'f5', name: 'F5 BIG-IP', icon: 'f5', category: 'infrastructure', keywords: ['load balancer', 'balanceador', 'waf'] },
  { id: 'haproxy', name: 'HAProxy', icon: 'glyph:network', category: 'infrastructure', keywords: ['load balancer', 'balanceador'] },
  { id: 'traefik', name: 'Traefik', icon: 'traefikproxy', category: 'infrastructure', keywords: ['ingress', 'proxy'] },
  { id: 'envoy', name: 'Envoy', icon: 'envoyproxy', category: 'infrastructure', keywords: ['proxy', 'mesh'] },
  { id: 'cloudflare', name: 'Cloudflare', icon: 'cloudflare', category: 'infrastructure', keywords: ['cdn', 'dns', 'waf'] },
  { id: 'apim', name: 'API Manager', icon: 'glyph:network', category: 'infrastructure', keywords: ['apim', 'gateway', 'api gateway'] },
  { id: 'entra-id', name: 'Microsoft Entra ID', icon: 'glyph:plug', category: 'saas', keywords: ['azure ad', 'aad', 'sso', 'microsoft'] },
  { id: 'keycloak', name: 'Keycloak', icon: 'keycloak', category: 'saas', keywords: ['iam', 'sso'] },
  { id: 'auth0', name: 'Auth0', icon: 'auth0', category: 'saas' },
  { id: 'okta', name: 'Okta', icon: 'okta', category: 'saas' },
  { id: 'salesforce', name: 'Salesforce', icon: 'salesforce', category: 'saas' },
  { id: 'sap', name: 'SAP', icon: 'sap', category: 'saas' },
];

/** Tipos de elemento que llevan el campo `technology`. */
export const KINDS_WITH_TECHNOLOGY: readonly ElementKind[] = ['system', 'container', 'component', 'node', 'infra'];

// -----------------------------------------------------------------------------------------------
// Protocolos de relaciones

export type ProtocolGroup = 'web' | 'messaging' | 'data' | 'files' | 'identity' | 'email' | 'network';

export const PROTOCOL_GROUP_LABEL: Readonly<Record<ProtocolGroup, string>> = {
  web: 'Web y APIs',
  messaging: 'Mensajería',
  data: 'Acceso a datos',
  files: 'Archivos',
  identity: 'Identidad',
  email: 'Correo',
  network: 'Red',
};

export interface Protocol extends CatalogItem {
  group: ProtocolGroup;
  /** Destinos para los que el protocolo es la opción natural (ordena las sugerencias). */
  fits?: {
    kinds?: readonly ElementKind[];
    storeTypes?: readonly StoreType[];
    engines?: readonly string[];
    brokers?: readonly string[];
    containerTypes?: readonly ContainerType[];
  };
}

const API_TARGETS = { kinds: ['system', 'container', 'component'] as ElementKind[], containerTypes: ['web', 'api', 'service', 'function'] as ContainerType[] };

/** Ordenados por grupo y, dentro de cada grupo, de más a menos habitual. */
export const PROTOCOLS: readonly Protocol[] = [
  // Web y APIs
  { id: 'https', name: 'HTTPS', icon: 'glyph:globe', group: 'web', fits: API_TARGETS, keywords: ['http', 'tls'] },
  { id: 'rest', name: 'REST/JSON', icon: 'glyph:globe', group: 'web', fits: API_TARGETS, keywords: ['json', 'http'] },
  { id: 'grpc', name: 'gRPC', icon: 'glyph:plug', group: 'web', fits: { containerTypes: ['api', 'service'] }, keywords: ['protobuf'] },
  { id: 'graphql', name: 'GraphQL', icon: 'graphql', group: 'web', fits: { containerTypes: ['api', 'web'] } },
  { id: 'websocket', name: 'WebSocket', icon: 'glyph:plug', group: 'web', keywords: ['ws', 'tiempo real'] },
  { id: 'sse', name: 'Server-Sent Events', icon: 'glyph:plug', group: 'web', keywords: ['sse', 'stream'] },
  { id: 'soap', name: 'SOAP/XML', icon: 'glyph:file', group: 'web', keywords: ['xml', 'wsdl'] },
  { id: 'webhook', name: 'Webhook', icon: 'glyph:plug', group: 'web', keywords: ['callback'] },
  { id: 'http', name: 'HTTP (sin TLS)', icon: 'glyph:globe', group: 'web' },
  // Mensajería
  { id: 'kafka', name: 'Kafka', icon: 'apachekafka', group: 'messaging', fits: { brokers: ['kafka', 'event-hubs'] } },
  { id: 'amqp', name: 'AMQP', icon: 'rabbitmq', group: 'messaging', fits: { brokers: ['rabbitmq', 'service-bus', 'activemq'] } },
  { id: 'jms', name: 'JMS', icon: 'glyph:queue', group: 'messaging', fits: { brokers: ['activemq', 'ibm-mq'] } },
  { id: 'mqtt', name: 'MQTT', icon: 'glyph:queue', group: 'messaging', fits: { brokers: ['mosquitto'] }, keywords: ['iot'] },
  { id: 'nats', name: 'NATS', icon: 'natsdotio', group: 'messaging', fits: { brokers: ['nats'] } },
  { id: 'pulsar', name: 'Pulsar', icon: 'apachepulsar', group: 'messaging', fits: { brokers: ['pulsar'] } },
  { id: 'stomp', name: 'STOMP', icon: 'glyph:queue', group: 'messaging', fits: { brokers: ['activemq', 'rabbitmq'] } },
  // Acceso a datos
  { id: 'jdbc', name: 'JDBC', icon: 'glyph:database', group: 'data', fits: { storeTypes: ['relational', 'warehouse', 'time-series'] } },
  { id: 'sql', name: 'SQL (driver nativo)', icon: 'glyph:database', group: 'data', fits: { storeTypes: ['relational', 'warehouse', 'time-series'] }, keywords: ['tcp', 'postgres', 'mysql'] },
  { id: 'odbc', name: 'ODBC', icon: 'glyph:database', group: 'data', fits: { storeTypes: ['relational', 'warehouse'] } },
  { id: 'mongodb-wire', name: 'MongoDB Wire', icon: 'mongodb', group: 'data', fits: { engines: ['mongodb', 'cosmosdb'] } },
  { id: 'resp', name: 'Redis (RESP)', icon: 'redis', group: 'data', fits: { engines: ['redis'] } },
  { id: 'memcached', name: 'Memcached', icon: 'memcached', group: 'data', fits: { engines: ['memcached'] } },
  { id: 'cql', name: 'CQL', icon: 'apachecassandra', group: 'data', fits: { engines: ['cassandra'] } },
  { id: 'bolt', name: 'Bolt', icon: 'neo4j', group: 'data', fits: { engines: ['neo4j'] } },
  { id: 's3-api', name: 'S3 API', icon: 'amazons3', group: 'data', fits: { storeTypes: ['object'] } },
  { id: 'search-api', name: 'API de búsqueda', icon: 'elasticsearch', group: 'data', fits: { storeTypes: ['search'] } },
  { id: 'dynamodb-api', name: 'DynamoDB API', icon: 'amazondynamodb', group: 'data', fits: { engines: ['dynamodb'] } },
  // Archivos
  { id: 'sftp', name: 'SFTP', icon: 'glyph:file', group: 'files', keywords: ['ssh'] },
  { id: 'ftps', name: 'FTP/FTPS', icon: 'glyph:file', group: 'files' },
  { id: 'smb', name: 'SMB/CIFS', icon: 'glyph:file', group: 'files' },
  { id: 'nfs', name: 'NFS', icon: 'glyph:file', group: 'files' },
  // Identidad
  { id: 'oauth2', name: 'OAuth 2.0', icon: 'glyph:plug', group: 'identity', keywords: ['token'] },
  { id: 'oidc', name: 'OpenID Connect', icon: 'openid', group: 'identity', keywords: ['sso'] },
  { id: 'saml', name: 'SAML 2.0', icon: 'glyph:plug', group: 'identity', keywords: ['sso'] },
  { id: 'ldap', name: 'LDAP', icon: 'glyph:server', group: 'identity', keywords: ['active directory'] },
  { id: 'kerberos', name: 'Kerberos', icon: 'glyph:server', group: 'identity' },
  // Correo
  { id: 'smtp', name: 'SMTP', icon: 'glyph:mail', group: 'email' },
  { id: 'imap', name: 'IMAP', icon: 'glyph:mail', group: 'email' },
  // Red
  { id: 'tcp', name: 'TCP', icon: 'glyph:network', group: 'network' },
  { id: 'udp', name: 'UDP', icon: 'glyph:network', group: 'network' },
  { id: 'ssh', name: 'SSH', icon: 'glyph:server', group: 'network' },
  { id: 'dns', name: 'DNS', icon: 'glyph:network', group: 'network' },
  { id: 'vpn', name: 'VPN/IPsec', icon: 'glyph:network', group: 'network' },
  { id: 'bgp', name: 'BGP', icon: 'glyph:network', group: 'network', keywords: ['ebgp', 'ibgp', 'ruteo'] },
  { id: 'tds', name: 'TDS (SQL Server)', icon: 'glyph:database', group: 'data', fits: { engines: ['sqlserver'] }, keywords: ['sql server', 'mssql', '1433'] },
];

/** Qué grupos de protocolos son naturales según el tipo de destino (de más a menos). */
const GROUP_AFFINITY: Readonly<Record<ElementKind, readonly ProtocolGroup[]>> = {
  store: ['data', 'network', 'files', 'web', 'identity', 'email', 'messaging'],
  bus: ['messaging', 'web', 'network', 'identity', 'data', 'files', 'email'],
  system: ['web', 'messaging', 'identity', 'files', 'email', 'data', 'network'],
  container: ['web', 'messaging', 'identity', 'files', 'data', 'email', 'network'],
  component: ['web', 'messaging', 'data', 'identity', 'files', 'email', 'network'],
  actor: ['web', 'email', 'identity', 'messaging', 'files', 'data', 'network'],
  group: ['network', 'web', 'messaging', 'data', 'files', 'identity', 'email'],
  node: ['network', 'web', 'data', 'messaging', 'identity', 'files', 'email'],
  infra: ['network', 'web', 'identity', 'data', 'messaging', 'files', 'email'],
  instance: ['web', 'messaging', 'data', 'identity', 'files', 'network', 'email'],
};

/**
 * Protocolos que tienen sentido hacia un destino, del más al menos natural: primero los que
 * encajan con su motor/broker/tipo (JDBC hacia PostgreSQL, Kafka hacia un bus Kafka) y después
 * por afinidad del grupo con el tipo de elemento.
 */
export function suggestProtocols(target: Element | undefined, query = '', limit = 10): Protocol[] {
  const q = query.trim().toLowerCase();
  const base = q ? searchCatalog(PROTOCOLS, q, PROTOCOLS.length) : [...PROTOCOLS];
  if (!target) return base.slice(0, limit);
  const engine = target.kind === 'store' ? findEngine(target.store.engine) : undefined;
  const broker = target.kind === 'bus' ? findBroker(target.bus.broker) : undefined;
  const affinity = GROUP_AFFINITY[target.kind];
  const fit = (p: Protocol): number => {
    const f = p.fits;
    let s = 0;
    if (broker?.protocol === p.id) s += 10;
    if (f?.brokers && target.kind === 'bus' && f.brokers.includes(target.bus.broker)) s += 6;
    if (f?.engines && target.kind === 'store' && f.engines.includes(target.store.engine)) s += 8;
    const storeType = target.kind === 'store' ? (target.store.type ?? engine?.type) : undefined;
    if (f?.storeTypes && storeType && f.storeTypes.includes(storeType)) s += 5;
    if (f?.containerTypes && target.kind === 'container' && target.containerType && f.containerTypes.includes(target.containerType)) s += 4;
    if (f?.kinds?.includes(target.kind)) s += 2;
    return s;
  };
  return base
    .map((p, i) => ({ p, fit: fit(p), group: affinity.indexOf(p.group), i }))
    .sort((a, b) => b.fit - a.fit || a.group - b.group || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

// -----------------------------------------------------------------------------------------------
// Otros catálogos

export interface ProviderItem extends CatalogItem {
  id: GroupProvider;
}

export const GROUP_PROVIDER_CATALOG: readonly ProviderItem[] = [
  { id: 'aws', name: 'AWS', icon: 'amazonwebservices', keywords: ['amazon'] },
  { id: 'gcp', name: 'Google Cloud', icon: 'googlecloud', keywords: ['gcp'] },
  { id: 'azure', name: 'Azure', icon: 'microsoftazure' },
  { id: 'onprem', name: 'On-premise', icon: 'glyph:server', keywords: ['datacenter', 'dc'] },
  { id: 'network', name: 'Red', icon: 'glyph:network', keywords: ['vpc', 'subnet', 'vnet'] },
  { id: 'platform', name: 'Plataforma', icon: 'glyph:layers', keywords: ['k8s', 'cluster'] },
  { id: 'other', name: 'Otro', icon: 'glyph:group' },
];

/** Proveedores de los nodos de despliegue (los de grupos más plataformas). */
export const NODE_PROVIDER_CATALOG: readonly CatalogItem[] = [
  ...GROUP_PROVIDER_CATALOG.filter((p) => p.id !== 'network' && p.id !== 'platform' && p.id !== 'other'),
  { id: 'openshift', name: 'OpenShift', icon: 'redhatopenshift', keywords: ['ocp', 'rosa'] },
  { id: 'kubernetes', name: 'Kubernetes', icon: 'kubernetes', keywords: ['k8s', 'eks', 'aks', 'gke'] },
  { id: 'vmware', name: 'VMware', icon: 'vmware' },
  { id: 'other', name: 'Otro', icon: 'glyph:server' },
];

export const NODE_TYPE_LABEL: Readonly<Record<NodeType, string>> = {
  datacenter: 'Datacenter',
  cloud: 'Nube / cuenta',
  region: 'Región',
  zone: 'Zona de disponibilidad',
  network: 'Red / VPC',
  subnet: 'Subred',
  cluster: 'Clúster',
  namespace: 'Namespace / proyecto',
  server: 'Servidor',
  vm: 'Máquina virtual',
  runtime: 'Runtime / servidor de aplicaciones',
  device: 'Dispositivo',
  other: 'Nodo',
};

export const INFRA_TYPE_LABEL: Readonly<Record<InfraType, string>> = {
  firewall: 'Firewall',
  'load-balancer': 'Balanceador de carga',
  dns: 'DNS',
  gateway: 'API gateway',
  ingress: 'Ingress',
  egress: 'Egress',
  nat: 'NAT',
  vpn: 'VPN',
  link: 'Enlace dedicado',
  'security-group': 'Security group',
  waf: 'WAF',
  cdn: 'CDN',
  proxy: 'Proxy',
  router: 'Router',
  other: 'Infraestructura',
};

export const CONTAINER_TYPE_LABEL: Readonly<Record<ContainerType, string>> = {
  web: 'Aplicación web',
  mobile: 'App móvil',
  desktop: 'App de escritorio',
  api: 'API',
  service: 'Servicio',
  worker: 'Worker / batch',
  function: 'Función serverless',
  other: 'Otro',
};

export const STORE_TYPE_LABEL: Readonly<Record<StoreType, string>> = {
  relational: 'Relacional',
  document: 'Documental',
  'key-value': 'Clave-valor',
  cache: 'Caché',
  search: 'Búsqueda',
  object: 'Objetos',
  graph: 'Grafos',
  'time-series': 'Series de tiempo',
  warehouse: 'Data warehouse',
  other: 'Otro',
};

export const BUS_TYPE_LABEL: Readonly<Record<BusType, string>> = {
  queue: 'Cola',
  topic: 'Tópicos (pub/sub)',
  stream: 'Stream',
  'event-bus': 'Event bus',
};

export const STATUS_LABEL: Readonly<Record<Status, string>> = {
  planned: 'Planificado',
  live: 'Productivo',
  deprecated: 'Deprecado',
  retired: 'Retirado',
};

export const RISK_LABEL: Readonly<Record<Risk, string>> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
};

const techById = new Map(TECHNOLOGIES.map((t) => [t.id, t]));
const engineById = new Map(DB_ENGINES.map((e) => [e.id, e]));
const brokerById = new Map(MESSAGE_BROKERS.map((b) => [b.id, b]));
const protocolById = new Map(PROTOCOLS.map((p) => [p.id, p]));

export function findTechnology(id: string): Technology | undefined {
  return techById.get(id.toLowerCase());
}

export function findEngine(id: string): DbEngine | undefined {
  return engineById.get(id);
}

export function findBroker(id: string): MessageBroker | undefined {
  return brokerById.get(id);
}

export function findProtocol(id: string): Protocol | undefined {
  return protocolById.get(id.toLowerCase());
}

/** Protocolos y puertos de una relación: "HTTPS :443, :80", "TCP :443", ":1433". */
export function relationTechnology(rel: { protocols?: readonly string[]; ports?: readonly number[] }): string {
  const protocols = (rel.protocols ?? []).map((p) => findProtocol(p)?.name ?? p).join(', ');
  const ports = (rel.ports ?? []).map((p) => `:${p}`).join(', ');
  return [protocols, ports].filter(Boolean).join(' ');
}

export function findProvider(id: string): ProviderItem | undefined {
  return GROUP_PROVIDER_CATALOG.find((p) => p.id === id);
}

/** Búsqueda simple por prefijo/substring en nombre, id y keywords. */
export function searchCatalog<T extends CatalogItem>(items: readonly T[], query: string, limit = 12): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const hay = [item.name.toLowerCase(), item.id, ...(item.keywords ?? [])];
    let score = -1;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 3);
      else if (h.startsWith(q)) score = Math.max(score, 2);
      else if (h.includes(q)) score = Math.max(score, 1);
    }
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit).map((s) => s.item);
}

/** Palabras con las que se busca cada tipo de nodo de despliegue ("vpc" → red, "ocp" → clúster). */
export const NODE_TYPE_KEYWORDS: Readonly<Record<NodeType, readonly string[]>> = {
  datacenter: ['datacenter', 'dc', 'centro de datos', 'on premise', 'onprem', 'cpd'],
  cloud: ['nube', 'cloud', 'cuenta', 'suscripcion', 'aws', 'azure', 'gcp'],
  region: ['region'],
  zone: ['zona', 'az', 'availability zone'],
  network: ['red', 'vpc', 'vnet', 'network'],
  subnet: ['subred', 'subnet'],
  cluster: ['cluster', 'openshift', 'ocp', 'rosa', 'kubernetes', 'k8s', 'eks', 'aks', 'gke'],
  namespace: ['namespace', 'proyecto', 'project', 'ns'],
  server: ['servidor', 'server', 'host', 'bare metal'],
  vm: ['vm', 'maquina virtual', 'ec2', 'instancia ec2'],
  runtime: ['runtime', 'jvm', 'tomcat', 'iis', 'servidor de aplicaciones', 'app server'],
  device: ['dispositivo', 'device', 'totem', 'kiosco', 'movil'],
  other: [],
};

export const INFRA_TYPE_KEYWORDS: Readonly<Record<InfraType, readonly string[]>> = {
  firewall: ['firewall', 'fw', 'fortigate', 'palo alto'],
  'load-balancer': ['balanceador', 'load balancer', 'lb', 'alb', 'nlb', 'elb', 'f5'],
  dns: ['dns', 'route 53', 'route53'],
  gateway: ['gateway', 'api gateway', 'apim', 'api manager'],
  ingress: ['ingress', 'entrada'],
  egress: ['egress', 'salida'],
  nat: ['nat'],
  vpn: ['vpn', 'ipsec'],
  link: ['enlace', 'direct connect', 'expressroute', 'interconnect', 'mpls'],
  'security-group': ['security group', 'sg', 'grupo de seguridad', 'nsg'],
  waf: ['waf'],
  cdn: ['cdn', 'cloudfront', 'akamai'],
  proxy: ['proxy', 'reverse proxy'],
  router: ['router'],
  other: [],
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Tipos de nodo e infraestructura que coinciden con un texto (para crear desde el lienzo). */
export function suggestDeploymentTypes(query: string, limit = 3): { nodes: NodeType[]; infra: InfraType[] } {
  const q = plain(query);
  if (q.length < 2) return { nodes: [], infra: [] };
  const hit = (label: string, words: readonly string[]) => [label, ...words].some((w) => plain(w).startsWith(q) || q.startsWith(plain(w)) || plain(w).split(' ').some((p) => p.startsWith(q)));
  const nodes = (Object.keys(NODE_TYPE_KEYWORDS) as NodeType[]).filter((t) => t !== 'other' && hit(NODE_TYPE_LABEL[t], NODE_TYPE_KEYWORDS[t]));
  const infra = (Object.keys(INFRA_TYPE_KEYWORDS) as InfraType[]).filter((t) => t !== 'other' && hit(INFRA_TYPE_LABEL[t], INFRA_TYPE_KEYWORDS[t]));
  return { nodes: nodes.slice(0, limit), infra: infra.slice(0, limit) };
}
