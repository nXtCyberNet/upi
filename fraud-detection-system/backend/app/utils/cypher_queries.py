"""
Centralised Cypher query repository.

Organisation
────────────
SCHEMA_*        – constraints & indexes (run once at startup)
INGEST_*        – transaction write-path
QUERY_*         – feature extraction reads
GDS_*           – Graph Data Science batch algorithms
DETECT_*        – fraud-pattern queries
VIZ_*           – visualisation exports
MAINT_*         – maintenance helpers

Neo4j Graph Schema
──────────────────
Nodes   :User  :Device  :IP  :Transaction  :Cluster
Edges   :SENT  :RECEIVED_BY  :USES_DEVICE  :ACCESSED_FROM
        :TRANSFERRED_TO  (User→User shortcut for graph analytics)
        :MEMBER_OF  (User→Cluster)
"""

# ==============================================================
# SCHEMA – constraints & indexes
# ==============================================================

SCHEMA_CONSTRAINTS: list[str] = [
    "CREATE CONSTRAINT user_id_uniq   IF NOT EXISTS FOR (u:User)        REQUIRE u.user_id     IS UNIQUE",
    "CREATE CONSTRAINT device_uniq    IF NOT EXISTS FOR (d:Device)      REQUIRE d.device_id   IS UNIQUE",
    "CREATE CONSTRAINT tx_id_uniq     IF NOT EXISTS FOR (t:Transaction) REQUIRE t.tx_id       IS UNIQUE",
    "CREATE CONSTRAINT ip_uniq        IF NOT EXISTS FOR (i:IP)          REQUIRE i.ip_address  IS UNIQUE",
    "CREATE CONSTRAINT cluster_uniq   IF NOT EXISTS FOR (c:Cluster)     REQUIRE c.cluster_id  IS UNIQUE",
]

SCHEMA_INDEXES: list[str] = [
    "CREATE INDEX idx_user_risk      IF NOT EXISTS FOR (u:User)        ON (u.risk_score)",
    "CREATE INDEX idx_user_dormant   IF NOT EXISTS FOR (u:User)        ON (u.is_dormant)",
    "CREATE INDEX idx_user_active    IF NOT EXISTS FOR (u:User)        ON (u.last_active)",
    "CREATE INDEX idx_tx_ts          IF NOT EXISTS FOR (t:Transaction) ON (t.timestamp)",
    "CREATE INDEX idx_tx_risk        IF NOT EXISTS FOR (t:Transaction) ON (t.risk_score)",
    "CREATE INDEX idx_device_score   IF NOT EXISTS FOR (d:Device)      ON (d.device_score)",
    "CREATE INDEX idx_cluster_risk   IF NOT EXISTS FOR (c:Cluster)     ON (c.risk_level)",
    "CREATE INDEX idx_ip_asn         IF NOT EXISTS FOR (i:IP)          ON (i.asn)",
]

# ==============================================================
# INGEST – lock-free hot transaction write path
# ==============================================================

# ─── Optimised: MATCH (not MERGE) for pre-seeded Users/Devices ───
# ─── No aggregation math on User (moved to background batch)  ───
# ─── Consistent lock order: sender_id < receiver_id first     ───

INGEST_TRANSACTION = """
MATCH (s:User {user_id: $sender_id})
MATCH (r:User {user_id: $receiver_id})
MERGE (d:Device {device_id: $device_id})
  ON CREATE SET d.device_score    = 0.0,
                d.account_count   = 0,
                d.os              = $device_os,
                d.device_type     = $device_type,
                d.app_version     = $app_version,
                d.capability_mask = $capability_mask,
                d.created_at      = datetime()
  ON MATCH SET  d.os              = coalesce($device_os, d.os),
                d.device_type     = coalesce($device_type, d.device_type),
                d.app_version     = coalesce($app_version, d.app_version),
                d.capability_mask = coalesce($capability_mask, d.capability_mask)

MERGE (tx:Transaction {tx_id: $tx_id})
  ON CREATE SET tx.amount          = $amount,
                tx.timestamp       = datetime($timestamp),
                tx.currency        = $currency,
                tx.txn_type        = $txn_type,
                tx.channel         = 'UPI',
                tx.credential_type = $credential_type,
                tx.credential_sub  = $credential_sub_type,
                tx.receiver_type   = $receiver_type,
                tx.mcc_code        = $mcc_code,
                tx.status          = 'PENDING',
                tx.risk_score      = 0.0

MERGE (s)-[:SENT]->(tx)
MERGE (tx)-[:RECEIVED_BY]->(r)
MERGE (s)-[:USES_DEVICE]->(d)

MERGE  (s)-[edge:TRANSFERRED_TO]->(r)
  ON CREATE SET edge.total_amount = $amount,
                edge.tx_count     = 1,
                edge.last_tx      = datetime($timestamp)
  ON MATCH  SET edge.total_amount = edge.total_amount + $amount,
                edge.tx_count     = edge.tx_count + 1,
                edge.last_tx      = datetime($timestamp)

// Only touch last_active — no aggregation math in hot path
SET s.last_active = datetime($timestamp),
    s.is_dormant  = false,
    s.upi_id      = coalesce($sender_upi_id, s.upi_id)
SET r.upi_id      = coalesce($receiver_upi_id, r.upi_id)

RETURN tx.tx_id AS tx_id
"""

# Fallback ingest for users not yet in graph (auto-creates)
INGEST_TRANSACTION_SAFE = """
MERGE (s:User {user_id: $sender_id})
  ON CREATE SET s.created_at    = datetime(),
                s.last_active   = datetime($timestamp),
                s.tx_count      = 0,
                s.total_outflow = 0.0,
                s.avg_tx_amount = 0.0,
                s.std_tx_amount = 0.0,
                s.is_dormant    = false,
                s.risk_score    = 0.0,
                s.upi_id        = $sender_upi_id
  ON MATCH SET  s.last_active   = datetime($timestamp),
                s.is_dormant    = false,
                s.upi_id        = coalesce($sender_upi_id, s.upi_id)

MERGE (r:User {user_id: $receiver_id})
  ON CREATE SET r.created_at    = datetime(),
                r.last_active   = datetime($timestamp),
                r.tx_count      = 0,
                r.total_outflow = 0.0,
                r.avg_tx_amount = 0.0,
                r.std_tx_amount = 0.0,
                r.is_dormant    = false,
                r.risk_score    = 0.0,
                r.upi_id        = $receiver_upi_id
  ON MATCH SET  r.upi_id        = coalesce($receiver_upi_id, r.upi_id)

MERGE (d:Device {device_id: $device_id})
  ON CREATE SET d.device_score    = 0.0,
                d.account_count   = 0,
                d.os              = $device_os,
                d.device_type     = $device_type,
                d.app_version     = $app_version,
                d.capability_mask = $capability_mask,
                d.created_at      = datetime()
  ON MATCH SET  d.os              = coalesce($device_os, d.os),
                d.device_type     = coalesce($device_type, d.device_type),
                d.app_version     = coalesce($app_version, d.app_version),
                d.capability_mask = coalesce($capability_mask, d.capability_mask)

MERGE (tx:Transaction {tx_id: $tx_id})
  ON CREATE SET tx.amount          = $amount,
                tx.timestamp       = datetime($timestamp),
                tx.currency        = $currency,
                tx.txn_type        = $txn_type,
                tx.channel         = 'UPI',
                tx.credential_type = $credential_type,
                tx.credential_sub  = $credential_sub_type,
                tx.receiver_type   = $receiver_type,
                tx.mcc_code        = $mcc_code,
                tx.status          = 'PENDING',
                tx.risk_score      = 0.0

MERGE (s)-[:SENT]->(tx)
MERGE (tx)-[:RECEIVED_BY]->(r)
MERGE (s)-[:USES_DEVICE]->(d)

MERGE  (s)-[edge:TRANSFERRED_TO]->(r)
  ON CREATE SET edge.total_amount = $amount,
                edge.tx_count     = 1,
                edge.last_tx      = datetime($timestamp)
  ON MATCH  SET edge.total_amount = edge.total_amount + $amount,
                edge.tx_count     = edge.tx_count + 1,
                edge.last_tx      = datetime($timestamp)

RETURN tx.tx_id AS tx_id
"""

INGEST_IP = """
MERGE (i:IP {ip_address: $ip_address})
  ON CREATE SET i.geo_lat     = $geo_lat,
                i.geo_lon     = $geo_lon,
                i.is_vpn      = $is_vpn,
                i.city        = $city,
                i.country     = $country,
                i.asn         = $asn,
                i.asn_type    = $asn_type,
                i.asn_org     = $asn_org,
                i.asn_country = $asn_country
  ON MATCH SET  i.asn         = coalesce($asn, i.asn),
                i.asn_type    = coalesce($asn_type, i.asn_type),
                i.asn_org     = coalesce($asn_org, i.asn_org),
                i.asn_country = coalesce($asn_country, i.asn_country)
WITH i
MATCH (u:User {user_id: $user_id})
MERGE (u)-[:ACCESSED_FROM]->(i)
"""

UPDATE_TX_RISK = """
MATCH (tx:Transaction {tx_id: $tx_id})
SET tx.risk_score = $risk_score,
    tx.status     = $status,
    tx.reason     = $reason,
    tx.sender_lat = $sender_lat,
    tx.sender_lon = $sender_lon
RETURN tx.tx_id AS tx_id
"""

UPDATE_USER_RISK = """
MATCH (u:User {user_id: $user_id})
SET u.risk_score = $risk_score
RETURN u.user_id AS user_id
"""

# ==============================================================
# QUERY – behavioural feature reads
# ==============================================================

QUERY_USER_TX_HISTORY = """
MATCH (u:User {user_id: $user_id})-[:SENT]->(tx:Transaction)
RETURN tx.amount    AS amount,
       tx.timestamp AS timestamp
ORDER BY tx.timestamp DESC
LIMIT $limit
"""

QUERY_USER_PROFILE = """
MATCH (u:User {user_id: $user_id})
RETURN u.user_id        AS user_id,
       u.avg_tx_amount  AS avg_tx_amount,
       u.std_tx_amount  AS std_tx_amount,
       u.tx_count       AS tx_count,
       u.total_outflow  AS total_outflow,
       u.last_active    AS last_active,
       u.is_dormant     AS is_dormant,
       u.risk_score     AS risk_score,
       u.last_lat       AS last_lat,
       u.last_lon       AS last_lon
"""

QUERY_UPDATE_USER_STATS = """
MATCH (u:User {user_id: $user_id})-[:SENT]->(tx:Transaction)
WITH u, collect(tx.amount) AS amounts, count(tx) AS cnt
WITH u, amounts, cnt,
     reduce(s = 0.0, a IN amounts | s + a) / cnt AS mean_amt
WITH u, amounts, cnt, mean_amt,
     sqrt(reduce(s = 0.0, a IN amounts |
          s + (a - mean_amt)*(a - mean_amt)) / cnt) AS std_amt
SET u.avg_tx_amount = mean_amt,
    u.std_tx_amount = std_amt,
    u.tx_count      = cnt
RETURN u.user_id AS user_id, mean_amt, std_amt, cnt
"""

QUERY_UPDATE_USER_LOCATION = """
MATCH (u:User {user_id: $user_id})
SET u.last_lat = $lat, u.last_lon = $lon
RETURN u.user_id AS user_id
"""

# ==============================================================
# QUERY – dead-account reads
# ==============================================================

QUERY_DORMANT_STATUS = """
MATCH (u:User {user_id: $user_id})
RETURN u.user_id        AS user_id,
       u.is_dormant     AS is_dormant,
       u.last_active    AS last_active,
       u.tx_count       AS tx_count,
       u.avg_tx_amount  AS avg_tx_amount,
       u.std_tx_amount  AS std_tx_amount
"""

QUERY_FLAG_DORMANT_ACCOUNTS = """
MATCH (u:User)
WHERE u.last_active < datetime() - duration({days: $dormant_days})
SET u.is_dormant = true
RETURN count(u) AS dormant_count
"""

QUERY_RECENT_INFLOW_OUTFLOW = """
MATCH (u:User {user_id: $user_id})
OPTIONAL MATCH (u)<-[:RECEIVED_BY]-(ti:Transaction)
  WHERE ti.timestamp > datetime() - duration({seconds: $window})
WITH u, coalesce(sum(ti.amount), 0) AS recent_in, count(ti) AS in_cnt
OPTIONAL MATCH (u)-[:SENT]->(to:Transaction)
  WHERE to.timestamp > datetime() - duration({seconds: $window})
RETURN u.user_id             AS user_id,
       recent_in             AS recent_inflow,
       coalesce(sum(to.amount), 0) AS recent_outflow,
       in_cnt                AS inflow_count,
       count(to)             AS outflow_count
"""

# ==============================================================
# QUERY – IP intelligence reads
# ==============================================================

QUERY_IP_RISK = """
MATCH (i:IP {ip_address: $ip_address})
OPTIONAL MATCH (i)<-[:ACCESSED_FROM]-(u:User)
WITH i, count(DISTINCT u) AS account_count
OPTIONAL MATCH (u2:User)
  WHERE u2.last_active > datetime() - duration({days: $active_days})
WITH i, account_count, count(DISTINCT u2) AS total_active
RETURN i.ip_address AS ip_address,
       coalesce(i.asn_type, 'UNKNOWN') AS asn_type,
       account_count,
       total_active
"""

# ── ASN intelligence reads ────────────────────────────────────

QUERY_ASN_DENSITY = """
MATCH (u:User)-[:ACCESSED_FROM]->(i:IP)
WHERE i.asn = $asn_number
RETURN count(DISTINCT u) AS account_count
"""

QUERY_USER_ASN_HISTORY = """
MATCH (u:User {user_id: $user_id})-[:ACCESSED_FROM]->(i:IP)
WHERE i.asn IS NOT NULL AND i.asn > 0
RETURN i.asn AS asn, count(i) AS usage_count
ORDER BY usage_count DESC
"""

# ── First-strike dormant wakeup detection ────────────────────
QUERY_DORMANT_WAKEUP = """
MATCH (u:User {user_id: $user_id})
WITH u,
     duration.between(u.last_active, datetime()).days AS days_slept
OPTIONAL MATCH (u)-[:SENT]->(tx:Transaction)
  WHERE tx.timestamp > datetime() - duration({hours: 1})
WITH u, days_slept,
     count(tx)      AS recent_tx_count,
     sum(tx.amount) AS recent_volume
RETURN u.user_id        AS user_id,
       u.is_dormant     AS is_dormant,
       u.last_active    AS last_active,
       u.created_at     AS created_at,
       u.tx_count       AS tx_count,
       u.avg_tx_amount  AS avg_tx_amount,
       days_slept,
       recent_tx_count,
       recent_volume,
       CASE
         WHEN days_slept > $dormant_days AND recent_tx_count > 0
         THEN true ELSE false
       END AS is_first_strike,
       CASE
         WHEN u.avg_tx_amount > 0 AND recent_volume > u.avg_tx_amount * 5
         THEN true ELSE false
       END AS is_volume_spike
"""

# ==============================================================
# QUERY – device-risk reads
# ==============================================================

QUERY_DEVICE_INFO = """
MATCH (d:Device {device_id: $device_id})
OPTIONAL MATCH (d)<-[:USES_DEVICE]-(u:User)
WITH d, collect(u.user_id) AS linked_users, count(u) AS acc_cnt
RETURN d.device_id        AS device_id,
       d.os               AS os,
       d.device_type      AS device_type,
       d.app_version      AS app_version,
       d.capability_mask  AS capability_mask,
       d.device_score     AS device_score,
       acc_cnt            AS account_count,
       linked_users
"""

QUERY_DEVICE_RISK_PROPAGATION = """
MATCH (d:Device {device_id: $device_id})<-[:USES_DEVICE]-(u:User)
WITH d,
     avg(u.risk_score)  AS avg_user_risk,
     max(u.risk_score)  AS max_user_risk,
     count(u)           AS user_count
RETURN d.device_id AS device_id,
       avg_user_risk,
       max_user_risk,
       user_count,
       CASE
         WHEN user_count >= 5              THEN 100.0
         WHEN user_count >= 3              THEN 70.0
         WHEN max_user_risk > 80           THEN 60.0
         ELSE coalesce(avg_user_risk * 0.5, 0)
       END AS device_risk_score
"""

QUERY_SHARED_DEVICE_CLUSTERS = """
MATCH (d:Device)<-[:USES_DEVICE]-(u:User)
WITH d, collect(u) AS users, count(u) AS cnt
WHERE cnt >= $min_accounts
RETURN d.device_id                      AS device_id,
       cnt                              AS user_count,
       [u IN users | u.user_id]         AS user_ids,
       [u IN users | u.risk_score]      AS risk_scores,
       d.device_score                   AS device_score
ORDER BY cnt DESC
"""

UPDATE_DEVICE_SCORE = """
MATCH (d:Device {device_id: $device_id})
SET d.device_score = $score
RETURN d.device_id AS device_id
"""

# ── New device-history query (for drift/new-device detection) ──

QUERY_USER_DEVICE_HISTORY = """
MATCH (u:User {user_id: $user_id})-[:USES_DEVICE]->(d:Device)
RETURN d.device_id        AS device_id,
       d.os               AS os,
       d.device_type      AS device_type,
       d.app_version      AS app_version,
       d.capability_mask  AS capability_mask,
       d.created_at       AS first_seen
ORDER BY d.created_at DESC
"""

# ── IP rotation query (unique IPs in recent window) ──

QUERY_IP_ROTATION = """
MATCH (u:User {user_id: $user_id})-[:ACCESSED_FROM]->(i:IP)
RETURN count(DISTINCT i.ip_address) AS unique_ip_count,
       collect(DISTINCT i.ip_address) AS ip_list
"""

# ── Recent amounts for fixed-amount pattern detection ──

QUERY_RECENT_AMOUNTS = """
MATCH (u:User {user_id: $user_id})-[:SENT]->(tx:Transaction)
WHERE tx.timestamp > datetime() - duration({hours: $window_hours})
RETURN tx.amount AS amount
ORDER BY tx.timestamp DESC
LIMIT 20
"""

QUERY_DEVICE_USERS_24H = """
MATCH (d:Device {device_id: $device_id})<-[:USES_DEVICE]-(u:User)
WHERE u.last_active > datetime() - duration({hours: 24})
RETURN count(DISTINCT u.user_id) AS unique_users_24h,
       collect(DISTINCT u.user_id) AS user_list
"""

QUERY_USER_HOUR_DISTRIBUTION = """
MATCH (u:User {user_id: $user_id})-[:SENT]->(tx:Transaction)
RETURN tx.timestamp.hour AS hour, count(tx) AS cnt
ORDER BY hour
"""

QUERY_IDENTICAL_TX_RECEIVER = """
MATCH (u:User {user_id: $sender_id})-[:SENT]->(tx:Transaction)
      -[:RECEIVED_BY]->(r:User {user_id: $receiver_id})
WHERE tx.timestamp > datetime() - duration({hours: $window_hours})
  AND abs(tx.amount - $amount) < 1.0
RETURN count(tx) AS identical_count
"""

# ==============================================================
# QUERY – graph-intelligence (per-user, fast-path)
# ==============================================================

QUERY_USER_GRAPH_FEATURES = """
MATCH (u:User {user_id: $user_id})
OPTIONAL MATCH (u)-[:TRANSFERRED_TO]->(out_n:User)
WITH u,
     count(DISTINCT out_n)               AS out_degree,
     collect(out_n.risk_score)           AS out_risks
OPTIONAL MATCH (in_n:User)-[:TRANSFERRED_TO]->(u)
WITH u, out_degree, out_risks,
     count(DISTINCT in_n)                AS in_degree,
     collect(in_n.risk_score)            AS in_risks
OPTIONAL MATCH (u)-[:USES_DEVICE]->(d:Device)
RETURN u.user_id          AS user_id,
       in_degree,
       out_degree,
       u.community_id     AS community_id,
       u.betweenness       AS betweenness,
       u.clustering_coeff  AS clustering_coeff,
       u.pagerank          AS pagerank,
       CASE WHEN size(out_risks) > 0
            THEN reduce(s=0.0, r IN out_risks | s+r)/size(out_risks)
            ELSE 0.0 END   AS avg_neighbor_risk,
       d.device_id         AS device_id,
       d.account_count     AS device_account_count
"""

QUERY_COMMUNITY_STATS = """
MATCH (u:User)
WHERE u.community_id = $community_id
WITH collect(u) AS members, count(u) AS cnt
WITH members, cnt,
     [m IN members | m.risk_score]                  AS risks,
     [m IN members | m.total_inflow + m.total_outflow] AS volumes
RETURN $community_id AS community_id,
       cnt           AS member_count,
       reduce(s=0.0, r IN risks | s+r)/cnt          AS avg_risk,
       reduce(s=0.0, v IN volumes | s+v)            AS total_volume,
       size([r IN risks WHERE r > 70])               AS high_risk_count
"""

# ==============================================================
# QUERY – velocity reads
# ==============================================================

QUERY_VELOCITY_FEATURES = """
MATCH (u:User {user_id: $user_id})-[:SENT]->(txo:Transaction)
  WHERE txo.timestamp > datetime() - duration({seconds: $window})
WITH u,
     count(txo)       AS send_cnt,
     sum(txo.amount)  AS total_sent
OPTIONAL MATCH (u)<-[:RECEIVED_BY]-(txi:Transaction)
  WHERE txi.timestamp > datetime() - duration({seconds: $window})
RETURN u.user_id       AS user_id,
       send_cnt        AS send_count,
       count(txi)      AS receive_count,
       total_sent      AS total_sent_window,
       coalesce(sum(txi.amount), 0) AS total_received_window,
       CASE WHEN coalesce(sum(txi.amount), 0) > 0
            THEN total_sent / sum(txi.amount)
            ELSE 0.0 END AS outflow_inflow_ratio,
       send_cnt + count(txi) AS total_activity
"""

# ==============================================================
# GDS – batch graph analytics (run every N seconds)
# ==============================================================

GDS_DROP_PROJECTION = """
CALL gds.graph.drop('fraud-graph', false)
YIELD graphName
RETURN graphName
"""

GDS_CREATE_PROJECTION = """
CALL gds.graph.project(
    'fraud-graph',
    'User',
    {
        TRANSFERRED_TO: {
            orientation: 'UNDIRECTED',
            properties: ['total_amount', 'tx_count']
        }
    }
)
YIELD graphName, nodeCount, relationshipCount
RETURN graphName, nodeCount, relationshipCount
"""

GDS_LOUVAIN = """
CALL gds.louvain.write('fraud-graph', {
    writeProperty: 'community_id'
})
YIELD communityCount, modularity, nodePropertiesWritten
RETURN communityCount, modularity, nodePropertiesWritten
"""

GDS_BETWEENNESS = """
CALL gds.betweenness.write('fraud-graph', {
    writeProperty: 'betweenness'
})
YIELD nodePropertiesWritten
RETURN nodePropertiesWritten
"""

GDS_PAGERANK = """
CALL gds.pageRank.write('fraud-graph', {
    writeProperty: 'pagerank',
    maxIterations: 20,
    dampingFactor: 0.85
})
YIELD nodePropertiesWritten, ranIterations
RETURN nodePropertiesWritten, ranIterations
"""

GDS_LOCAL_CLUSTERING = """
CALL gds.localClusteringCoefficient.write('fraud-graph', {
    writeProperty: 'clustering_coeff'
})
YIELD nodeCount, nodePropertiesWritten
RETURN nodeCount, nodePropertiesWritten
"""

GDS_WCC = """
CALL gds.wcc.write('fraud-graph', {
    writeProperty: 'component_id'
})
YIELD componentCount, nodePropertiesWritten
RETURN componentCount, nodePropertiesWritten
"""

# ==============================================================
# FALLBACK – pure-Cypher approximations when GDS is unavailable
# ==============================================================

# Probe: returns True if GDS is installed
GDS_PROBE = """
RETURN gds.version() AS version
"""

# Community detection fallback: label-propagation-style via
# connected component walk (assigns community_id = min user_id
# in each weakly-connected component via iterative BFS).
FALLBACK_COMMUNITY_DETECTION = """
MATCH (u:User)
WHERE (u)-[:TRANSFERRED_TO]-() OR ()-[:TRANSFERRED_TO]->(u)
WITH u
ORDER BY u.user_id
WITH collect(u) AS users
UNWIND users AS start
WITH start
WHERE start.community_id IS NULL
CALL {
  WITH start
  MATCH path = (start)-[:TRANSFERRED_TO*1..6]-(connected:User)
  WITH DISTINCT connected, start.user_id AS cid
  SET connected.community_id = cid
  RETURN count(connected) AS members
}
SET start.community_id = start.user_id
RETURN count(start) AS communityCount, sum(1) AS nodePropertiesWritten
"""

# Betweenness approximation: degree-product proxy.
# Nodes bridging many high-fan-in/out neighbours score higher.
FALLBACK_BETWEENNESS = """
MATCH (u:User)
OPTIONAL MATCH (u)-[:TRANSFERRED_TO]->(out_n:User)
WITH u, count(DISTINCT out_n) AS out_deg
OPTIONAL MATCH (in_n:User)-[:TRANSFERRED_TO]->(u)
WITH u, out_deg, count(DISTINCT in_n) AS in_deg
WITH u, in_deg, out_deg,
     toFloat(in_deg * out_deg) AS raw_between
WITH collect({node: u, raw: raw_between}) AS rows,
     max(toFloat(in_deg * out_deg)) AS max_val
UNWIND rows AS r
WITH r.node AS u,
     CASE WHEN max_val > 0 THEN r.raw / max_val ELSE 0.0 END AS normed
SET u.betweenness = normed
RETURN count(u) AS nodePropertiesWritten,
       min(normed) AS minimumScore,
       max(normed) AS maximumScore
"""

# PageRank approximation: normalised weighted in-degree.
FALLBACK_PAGERANK = """
MATCH (u:User)
OPTIONAL MATCH (u)<-[e:TRANSFERRED_TO]-()
WITH u, sum(coalesce(e.total_amount, 0)) AS weighted_in
WITH collect({node: u, wi: weighted_in}) AS rows,
     max(weighted_in) AS max_wi
UNWIND rows AS r
WITH r.node AS u,
     CASE WHEN max_wi > 0 THEN r.wi / max_wi ELSE 0.0 END AS pr
SET u.pagerank = pr
RETURN count(u) AS nodePropertiesWritten, 1 AS ranIterations
"""

# Local clustering coefficient approximation:
# ratio of actual triangles to possible triangles around each node.
FALLBACK_CLUSTERING_COEFF = """
MATCH (u:User)
OPTIONAL MATCH (u)-[:TRANSFERRED_TO]-(n1:User)
WITH u, collect(DISTINCT n1) AS neighbours, count(DISTINCT n1) AS deg
WHERE deg >= 2
WITH u, neighbours, deg, deg * (deg - 1) / 2.0 AS possible
UNWIND range(0, size(neighbours)-2) AS i
UNWIND range(i+1, size(neighbours)-1) AS j
WITH u, possible,
     neighbours[i] AS a, neighbours[j] AS b
OPTIONAL MATCH (a)-[:TRANSFERRED_TO]-(b)
WITH u, possible, count(b) AS triangles
SET u.clustering_coeff = triangles / possible
RETURN count(u) AS nodeCount, count(u) AS nodePropertiesWritten
"""

# For nodes with degree < 2 set clustering_coeff = 0
FALLBACK_CLUSTERING_COEFF_ZERO = """
MATCH (u:User)
WHERE u.clustering_coeff IS NULL
SET u.clustering_coeff = 0.0
RETURN count(u) AS zeroed
"""

# ==============================================================
# DETECT – fraud pattern queries
# ==============================================================

DETECT_CIRCULAR_FLOWS = """
MATCH path = (a:User)-[:TRANSFERRED_TO]->(b:User)
                     -[:TRANSFERRED_TO]->(c:User)
                     -[:TRANSFERRED_TO]->(a)
WHERE a <> b AND b <> c AND a <> c
WITH a, b, c,
     [(a)-[r:TRANSFERRED_TO]->(b) | r][0] AS r1,
     [(b)-[r:TRANSFERRED_TO]->(c) | r][0] AS r2,
     [(c)-[r:TRANSFERRED_TO]->(a) | r][0] AS r3
WHERE r1.last_tx > datetime() - duration({days: 7})
RETURN a.user_id AS node_a,
       b.user_id AS node_b,
       c.user_id AS node_c,
       r1.total_amount AS flow_ab,
       r2.total_amount AS flow_bc,
       r3.total_amount AS flow_ca,
       r1.total_amount + r2.total_amount + r3.total_amount
         AS total_circular_flow
ORDER BY total_circular_flow DESC
LIMIT 50
"""

DETECT_STAR_HUBS = """
MATCH (hub:User)
WHERE hub.tx_count > 5
WITH hub,
     size([(hub)<-[:TRANSFERRED_TO]-() | 1]) AS in_deg,
     size([(hub)-[:TRANSFERRED_TO]->() | 1]) AS out_deg
WHERE in_deg >= $min_in_degree OR out_deg >= $min_out_degree
RETURN hub.user_id      AS user_id,
       in_deg           AS in_degree,
       out_deg          AS out_degree,
       hub.total_inflow AS total_inflow,
       hub.total_outflow AS total_outflow,
       hub.risk_score   AS risk_score,
       CASE
         WHEN in_deg >= 5 AND out_deg <= 2 THEN 'COLLECTOR'
         WHEN out_deg >= 5 AND in_deg <= 2 THEN 'DISTRIBUTOR'
         ELSE 'RELAY'
       END AS hub_type
ORDER BY in_deg + out_deg DESC
LIMIT 50
"""

DETECT_RAPID_CHAINS = """
MATCH path = (start:User)-[:TRANSFERRED_TO*2..4]->(finish:User)
WHERE start <> finish
WITH start, finish, path,
     [r IN relationships(path) | r.last_tx]       AS timestamps,
     [r IN relationships(path) | r.total_amount]   AS amounts,
     length(path) AS depth
WHERE ALL(i IN range(0, size(timestamps)-2)
      WHERE duration.between(timestamps[i], timestamps[i+1]).seconds < 300)
RETURN start.user_id                  AS chain_start,
       finish.user_id                 AS chain_end,
       [n IN nodes(path) | n.user_id] AS chain_nodes,
       depth,
       reduce(s=0.0, a IN amounts | s+a) AS total_flow
ORDER BY total_flow DESC
LIMIT 30
"""

DETECT_FRAUD_ISLANDS = """
MATCH (u:User)
WHERE u.community_id IS NOT NULL
WITH u.community_id AS cid, collect(u) AS members, count(u) AS cnt
WHERE cnt >= 3
WITH cid, members, cnt,
     [m IN members | m.risk_score] AS risks
WITH cid, members, cnt, risks,
     reduce(s=0.0, r IN risks | s+r)/cnt AS avg_risk
WHERE avg_risk > $min_avg_risk
RETURN cid                                      AS cluster_id,
       cnt                                      AS member_count,
       avg_risk,
       [m IN members | m.user_id]               AS member_ids,
       size([r IN risks WHERE r > 70])           AS high_risk_members
ORDER BY avg_risk DESC
"""

DETECT_MONEY_ROUTERS = """
MATCH (u:User)
WHERE u.betweenness IS NOT NULL AND u.betweenness > $min_betweenness
RETURN u.user_id       AS user_id,
       u.betweenness   AS betweenness,
       u.risk_score    AS risk_score,
       u.total_inflow  AS total_inflow,
       u.total_outflow AS total_outflow,
       u.community_id  AS community_id,
       u.tx_count      AS tx_count
ORDER BY u.betweenness DESC
LIMIT 20
"""

DETECT_DORMANT_ACTIVATION = """
MATCH (a:User {is_dormant: true})-[:SENT]->(tx:Transaction)
WHERE tx.timestamp > datetime() - duration({hours: 24})
  AND tx.amount > coalesce(a.avg_tx_amount, 0) * 5
RETURN a.user_id       AS user_id,
       a.last_active   AS last_active,
       tx.tx_id        AS tx_id,
       tx.amount       AS amount,
       a.avg_tx_amount AS avg_tx_amount,
       a.tx_count      AS historical_tx_count
ORDER BY tx.amount DESC
LIMIT 30
"""

# ── Relay mule detection (flow ratio in short window) ────────
DETECT_RELAY_MULE = """
MATCH (u:User)
WHERE u.tx_count > 3
WITH u
OPTIONAL MATCH (u)<-[:RECEIVED_BY]-(ti:Transaction)
  WHERE ti.timestamp > datetime() - duration({minutes: 10})
WITH u, coalesce(sum(ti.amount), 0) AS total_in_10m, count(ti) AS in_count
OPTIONAL MATCH (u)-[:SENT]->(to:Transaction)
  WHERE to.timestamp > datetime() - duration({minutes: 10})
WITH u, total_in_10m, in_count,
     coalesce(sum(to.amount), 0) AS total_out_10m, count(to) AS out_count
WHERE total_in_10m > 0 AND in_count >= 2 AND out_count >= 2
WITH u, total_in_10m, total_out_10m, in_count, out_count,
     total_out_10m / total_in_10m AS flow_ratio
WHERE flow_ratio > $min_flow_ratio
RETURN u.user_id        AS user_id,
       total_in_10m     AS total_inflow_10m,
       total_out_10m    AS total_outflow_10m,
       flow_ratio,
       in_count + out_count AS tx_count_10m,
       u.risk_score     AS risk_score,
       u.community_id   AS community_id,
       'HIGH_VELOCITY_RELAY' AS relay_type
ORDER BY flow_ratio DESC
LIMIT 50
"""

# ── Background batch user-stats aggregation ──────────────────
# Runs outside hot path (in graph_analyzer batch loop)
BATCH_UPDATE_USER_STATS = """
MATCH (u:User)
WHERE u.last_active > datetime() - duration({seconds: $window_sec})
WITH u
OPTIONAL MATCH (u)-[:SENT]->(txo:Transaction)
WITH u,
     count(txo)               AS cnt_out,
     coalesce(sum(txo.amount), 0) AS sum_out,
     collect(txo.amount)      AS amounts_out
OPTIONAL MATCH (u)<-[:RECEIVED_BY]-(txi:Transaction)
WITH u, cnt_out, sum_out, amounts_out,
     coalesce(sum(txi.amount), 0) AS sum_in
WITH u, cnt_out, sum_out, sum_in, amounts_out,
     CASE WHEN size(amounts_out) > 0
          THEN reduce(s=0.0, a IN amounts_out | s+a) / size(amounts_out)
          ELSE 0.0 END AS mean_amt,
     size(amounts_out) AS total_tx
SET u.tx_count      = total_tx,
    u.total_outflow = sum_out,
    u.total_inflow  = sum_in,
    u.avg_tx_amount = mean_amt
RETURN count(u) AS users_updated
"""

# ── Background device account-count refresh ──────────────────
BATCH_UPDATE_DEVICE_STATS = """
MATCH (d:Device)<-[:USES_DEVICE]-(u:User)
WITH d, count(u) AS cnt
SET d.account_count = cnt
RETURN count(d) AS devices_updated
"""

# ==============================================================
# VIZ – visualisation export queries
# ==============================================================

VIZ_FRAUD_NETWORK = """
MATCH (u:User)
WHERE u.risk_score > $min_risk OR u.community_id IN $cluster_ids
OPTIONAL MATCH (u)-[r:TRANSFERRED_TO]->(v:User)
  WHERE v.risk_score > $min_risk OR v.community_id IN $cluster_ids
RETURN u.user_id      AS source_id,
       u.risk_score   AS source_risk,
       u.community_id AS source_cluster,
       v.user_id      AS target_id,
       v.risk_score   AS target_risk,
       v.community_id AS target_cluster,
       r.total_amount AS edge_amount,
       r.tx_count     AS edge_tx_count
ORDER BY u.risk_score DESC, v.risk_score DESC
LIMIT 200
"""

VIZ_DEVICE_SHARING = """
MATCH (d:Device)<-[:USES_DEVICE]-(u:User)
WITH d,
     collect({id: u.user_id, risk: u.risk_score}) AS users,
     count(u) AS cnt
WHERE cnt >= 2
RETURN d.device_id     AS device_id,
       cnt             AS shared_count,
       users,
       d.device_score  AS device_score
ORDER BY cnt DESC
LIMIT 100
"""

VIZ_DASHBOARD_STATS = """
MATCH (tx:Transaction)
WITH count(tx)          AS total_tx,
     sum(tx.amount)     AS total_amount,
     avg(tx.risk_score) AS avg_risk
OPTIONAL MATCH (f:Transaction)
  WHERE f.risk_score > $high_threshold
WITH total_tx, total_amount, avg_risk, count(f) AS flagged
OPTIONAL MATCH (c:Cluster)
  WHERE c.risk_level IN ['HIGH', 'CRITICAL']
RETURN total_tx, total_amount, avg_risk, flagged,
       count(c) AS active_clusters
"""

# ==============================================================
# MAINT – maintenance helpers
# ==============================================================

MAINT_CLEAR_ALL = "MATCH (n) DETACH DELETE n"

MAINT_COUNT_NODES = """
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS count
ORDER BY count DESC
"""

MAINT_COUNT_RELS = """
MATCH ()-[r]->()
RETURN type(r) AS type, count(r) AS count
ORDER BY count DESC
"""
