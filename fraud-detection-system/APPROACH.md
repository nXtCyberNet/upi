# Mathematical Approach & Algorithm Reference

> **Deep-dive into the mathematical foundations, statistical models, and graph algorithms powering the Real-Time Mule & Collusive Fraud Intelligence Engine.**
>
> For architecture, features overview, API reference, and deployment → see [README.md](README.md)

---

## Table of Contents

1. [Risk Fusion Formula](#1-risk-fusion-formula)
2. [Behavioural Intelligence — Full Derivations](#2-behavioural-intelligence--full-derivations)
3. [Graph Intelligence — Algorithm Foundations](#3-graph-intelligence--algorithm-foundations)
4. [Device Risk — Scoring Models](#4-device-risk--scoring-models)
5. [Dead Account Detection — Mathematical Model](#5-dead-account-detection--mathematical-model)
6. [Velocity & Pass-Through — Burst Calculus](#6-velocity--pass-through--burst-calculus)
7. [Indian IPv4 ASN Intelligence — 8-Step Pipeline](#7-indian-ipv4-asn-intelligence--8-step-pipeline)
8. [Graph Data Science Algorithms](#8-graph-data-science-algorithms)
9. [Anomaly Detection Primitives](#9-anomaly-detection-primitives)
10. [Evaluation Metrics](#10-evaluation-metrics)
11. [Consolidated Symbol Reference](#11-consolidated-symbol-reference)

---

## 1. Risk Fusion Formula

### 1.1 Master Risk Equation

$$
R = w_g \cdot S_{\text{graph}} + w_b \cdot S_{\text{behavioral}} + w_d \cdot S_{\text{device}} + w_a \cdot S_{\text{dead}} + w_v \cdot S_{\text{velocity}}
$$

Where each sub-score $S_i \in [0, 100]$ and the final score is capped:

$$
R_{\text{final}} = \min(R, 100)
$$

### 1.2 Weight Vector

| Component          | Symbol | Weight | Rationale                                 |
| ------------------ | ------ | ------ | ----------------------------------------- |
| Graph Intelligence | $w_g$  | 0.30   | Network topology is strongest mule signal |
| Behavioural        | $w_b$  | 0.25   | Amount anomaly + geo + ASN intelligence   |
| Device Risk        | $w_d$  | 0.20   | Shared hardware / emulator patterns       |
| Dead Account       | $w_a$  | 0.15   | Dormant reactivation fraud                |
| Velocity           | $w_v$  | 0.10   | Burst / pass-through timing               |

### 1.3 Risk Level Classification

$$
\text{Level} = \begin{cases}
\textbf{HIGH} & R \geq 70 \\
\textbf{MEDIUM} & 40 \leq R < 70 \\
\textbf{LOW} & R < 40
\end{cases}
$$

### 1.4 Concurrent Scoring Pipeline

All extractors execute concurrently:

```python
behav, dead, device, graph, vel = await asyncio.gather(
    behavioral.compute(sender_id, amount, timestamp, lat, lon, channel, ip, sim),
    dead_account.compute(sender_id, amount),
    device_risk.compute(device_hash),
    graph_intel.compute(sender_id),
    velocity.compute(sender_id, amount),
)
```

Post-scoring pipeline: Flag aggregation → Collusive cluster lookup (O(1) cached) → Mule heuristic → Deduplication → Explainability → Persist → WebSocket alert if $R \geq 40$.

---

## 2. Behavioural Intelligence — Full Derivations

**File:** `app/features/behavioral.py`

### 2.1 Amount Z-Score (UPI Only, 3σ Rule)

**Primary path** (≥ 2 historical transactions):

$$
z = \frac{A_t - \bar{A}_{25}}{\sigma_{25}}
$$

**Fallback** (thin history):

$$
z = \frac{A_t - \mu_{\text{profile}}}{\sigma_{\text{profile}}} \quad \text{where } \sigma_{\text{profile}} = \max(\sigma_{\text{stored}}, 0.5 \cdot \mu_{\text{profile}})
$$

**3σ Spike flag:**

$$
\text{Spike} = \mathbb{1}[A_t > \bar{A} + 3\sigma]
$$

### 2.2 IQR Outlier Detection (Replaced Mahalanobis)

Applicable when $N \geq 4$ historical transactions:

$$
Q_1 = P_{25}(\text{amounts}), \quad Q_3 = P_{75}(\text{amounts}), \quad IQR = Q_3 - Q_1
$$

$$
\text{Outlier} = \mathbb{1}[x < Q_1 - 1.5 \cdot IQR \;\lor\; x > Q_3 + 1.5 \cdot IQR]
$$

**Why IQR over Mahalanobis:**
- Mahalanobis requires $N > 30$ for stable covariance estimation; fails for new users
- IQR is robust with as few as 4 samples
- Non-parametric: no Gaussian assumption
- Lower computational cost (no matrix inversion)

Contribution: **+15 points** if outlier detected.

### 2.3 Circadian Anomaly Detection

Detects transactions at hours statistically unusual for the specific user.

```cypher
MATCH (u:User {user_id: $user_id})-[:SENT]->(tx:Transaction)
RETURN tx.timestamp.hour AS hour, count(tx) AS cnt
```

$$
p(h) = \frac{\text{count}(\text{tx at hour } h)}{\text{total\_tx}}
$$

$$
C_{\text{circadian}} = \begin{cases}
35 & p(h) < 0.02 \;\text{AND}\; \text{is\_new\_device} \\
20 & p(h) < 0.02 \\
0 & \text{otherwise}
\end{cases}
$$

Requires: $\text{total\_tx} \geq 10$.

The compound (circadian + new device) is computed post-gather in the risk engine since behavioral and device extractors run concurrently.

### 2.4 TX Identicality Index

Detects structuring — same sender sending identical amounts to the same receiver repeatedly.

$$
I(s, r, a, w) = |\{tx : \text{sender}=s,\; \text{receiver}=r,\; |tx.\text{amount} - a| < 1,\; tx \in \text{window}_w\}|
$$

$$
\text{TxIdent} = \mathbb{1}[I \geq 3]
$$

Contribution: **+30 points**. Common structuring amounts in Indian UPI fraud: ₹4,999, ₹5,000, ₹7,500, ₹9,999.

### 2.5 Dormant Burst Signal

$$
\text{DormantBurst} = \mathbb{1}[\text{is\_dormant} \;\land\; \mu_{\text{profile}} > 0 \;\land\; A_t > \mu_{\text{profile}}]
$$

### 2.6 Velocity Feature

$$
\Delta t = t_{\text{current}} - t_{\text{last}}
$$

Burst window (60s):

$$
V = \min\left(\frac{\text{recent\_tx\_count}}{B_{\text{burst}}}, 1.0\right) \quad \text{where } B_{\text{burst}} = 10
$$

### 2.7 Night-Time Flag

$$
\text{Night} = \mathbb{1}[\text{hour} \geq 23 \;\lor\; \text{hour} \leq 5]
$$

### 2.8 Geo Distance & Impossible Travel (Haversine)

$$
a = \sin^2\!\left(\frac{\Delta\varphi}{2}\right) + \cos(\varphi_1) \cdot \cos(\varphi_2) \cdot \sin^2\!\left(\frac{\Delta\lambda}{2}\right)
$$

$$
d = 2R \cdot \arctan2\!\left(\sqrt{a},\; \sqrt{1-a}\right) \quad \text{where } R = 6371 \text{ km}
$$

Impossible travel condition:

$$
\text{ImpossibleTravel} = \mathbb{1}\!\left[\frac{d}{\Delta t / 3600} > 250 \;\text{km/h}\right]
$$

250 km/h chosen as realistic domestic upper bound.

### 2.9 Full Behavioural Risk Aggregation

$$
S_b = \min\!\bigg(
  \min(|z| \cdot 10, 30)
  + V \cdot 20
  + \mathbb{1}[\text{IT}] \cdot 20
  + \mathbb{1}[\text{Night}] \cdot 5
  + \mathbb{1}[\text{IQR}] \cdot 15
  + \mathbb{1}[\text{Spike}] \cdot 10
  + \mathbb{1}[\text{DormantBurst}] \cdot 15
  + R_{\text{ASN}} \cdot 20
$$
$$
  + \mathbb{1}[\text{IPRotation}] \cdot 15
  + \mathbb{1}[\text{FixedAmt}] \cdot 10
  + C_{\text{circadian}}
  + \mathbb{1}[\text{TxIdent}] \cdot 30
,\; 100\bigg)
$$

| Component           | Max Points | Status |
| ------------------- | ---------- | ------ |
| Amount z-score      | 30         | ✅ Active |
| Velocity            | 20         | ✅ Active |
| Impossible travel   | 20         | ✅ Active |
| IQR outlier         | 15         | ✅ v3 (replaced Mahalanobis) |
| Dormant burst       | 15         | ✅ Active |
| 3σ spike            | 10         | ✅ Active |
| ASN risk            | 20         | ✅ Active |
| IP rotation         | 15         | ✅ Active |
| Fixed-amount        | 10         | ✅ Active |
| Circadian anomaly   | 20 / 35    | ✅ v3 (35 if compound w/ new device) |
| TX identicality     | 30         | ✅ v3 |
| Night flag          | 5          | ✅ Active |

Raw total may exceed 100 but is capped.

---

## 3. Graph Intelligence — Algorithm Foundations

**File:** `app/features/graph_intelligence.py`

### 3.1 Community Risk

If `community_id` exists, execute `QUERY_COMMUNITY_STATS`:

$$
\text{CommunityRisk} = \begin{cases}
\min(\bar{R}_{\text{cluster}}, 100) & \text{members} \geq 3 \;\land\; \bar{R}_{\text{cluster}} > 50 \\
40 & \text{high\_risk\_count} \geq 2 \\
0 & \text{otherwise}
\end{cases}
$$

### 3.2 Betweenness Centrality Score

$$
\text{CentralityScore} = \min(b \cdot 200, 30)
$$

In ~500-node graphs, $b$ typically peaks near 0.1. Scaling factor (200) normalizes into $[0, 30]$.

### 3.3 PageRank Score

$$
\text{PageRankScore} = \min(PR \cdot 500, 15)
$$

Capped at 15 to prevent dominance over community-level signals.

### 3.4 Structural Anomaly Patterns

| Pattern               | Detection Rule                                       | Points |
| --------------------- | ---------------------------------------------------- | ------ |
| Fan-Out (Distributor) | $\text{out\_degree} \geq 5 \;\land\; \text{in\_degree} \leq 2$ | +15    |
| Fan-In (Collector)    | $\text{in\_degree} \geq 5 \;\land\; \text{out\_degree} \leq 2$ | +15    |
| Tight Ring            | $\text{clustering\_coeff} > 0.5 \;\land\; \text{total\_degree} > 4$ | +10    |

### 3.5 Neighbour Risk Contagion

$$
\text{Contagion} = \min(\bar{R}_{\text{neighbour}} \cdot 0.3, 15)
$$

### 3.6 Graph Risk Fusion

$$
S_{\text{graph}} = \min\!\Big(0.30 \cdot \text{CommunityRisk} + \text{CentralityScore} + \text{PageRankScore} + \text{StructuralScore} + \text{Contagion},\; 100\Big)
$$

---

## 4. Device Risk — Scoring Models

**File:** `app/features/device_risk.py`

### 4.1 Multi-Account Exposure

$$
\text{MultiAccount} = \begin{cases}
40 & N_{\text{accounts}} \geq 5 \\
25 & N_{\text{accounts}} \geq 3 \\
10 & N_{\text{accounts}} \geq 2 \\
0 & \text{otherwise}
\end{cases}
$$

### 4.2 Device Risk Propagation

$$
\text{Propagation} = \min\!\left(\frac{R_{\text{device}}}{100}, 1\right) \cdot 25
$$

Device base risk (Cypher logic):

| Condition               | Device Score                   |
| ----------------------- | ------------------------------ |
| $\text{user\_count} \geq 5$ | 100                        |
| $\text{user\_count} \geq 3$ | 70                         |
| $\max(\text{user\_risk}) > 80$ | 60                      |
| Default                 | $\bar{R}_{\text{user}} \cdot 0.5$ |

### 4.3 Device Drift Score

**OS Family Change:**

$$
\text{OS\_Drift} = \begin{cases}
5 & \text{stored\_os\_family} \neq \text{current\_os\_family} \\
0 & \text{otherwise}
\end{cases}
$$

**Capability Mask Change (Hamming Distance):**

$$
\Delta_{\text{mask}} = \text{HammingDistance}(\text{stored\_mask},\; \text{current\_mask})
$$

$$
\text{Cap\_Drift} = \min(\Delta_{\text{mask}} \cdot w_{\text{cap}} \cdot 0.3, 5.0)
$$

Total drift score capped at 15.

### 4.4 SIM-Swap Multi-User Detection

$$
N_{\text{users}} = |\{u : (u)\text{-[:USES\_DEVICE]->(d)},\; u.\text{last\_active} > t - 24h\}|
$$

$$
\text{SIM\_Swap} = \mathbb{1}[N_{\text{users}} > 3] \cdot 25
$$

### 4.5 New Device + High Amount + MPIN Compound

$$
\text{Compound} = \begin{cases}
15 & \text{is\_new\_device} \;\land\; A_t \geq 10{,}000 \;\land\; \text{credential} = \text{MPIN} \\
0 & \text{otherwise}
\end{cases}
$$

### 4.6 Device Risk Fusion

$$
S_{\text{device}} = \min\!\Big(\text{MultiAccount} + \text{Propagation} + \text{HighRiskBonus} + \text{OSAnomaly} + \text{DeviceDrift} + \text{NewDevicePenalty} + \text{SIM\_Swap} + \text{NewDeviceHighMPIN},\; 100\Big)
$$

| Component              | Max Points | Status |
| ---------------------- | ---------- | ------ |
| Multi-Account          | 40         | ✅ Active |
| Risk Propagation       | 25         | ✅ Active |
| SIM-Swap Multi-User    | 25         | ✅ v3 |
| Device Drift           | 15         | ✅ v3 |
| New Device + MPIN      | 15         | ✅ v3 |
| New Device Penalty     | 12         | ✅ Active |
| High-Risk Bonus        | 10         | ✅ Active |
| OS Anomaly             | 10         | ✅ Active |

Theoretical maximum = 152 (capped to 100).

---

## 5. Dead Account Detection — Mathematical Model

**File:** `app/features/dead_account.py`

### 5.1 Inactivity Score

$$
\text{Inactivity} = \min\!\left(\frac{\text{days\_slept}}{30}, 1\right) \cdot 30
$$

### 5.2 Spike Score

$$
\text{Spike} = \begin{cases}
\min\!\left(\frac{A_t / \bar{A}_{\text{profile}}}{10}, 1\right) \cdot 30 & \bar{A}_{\text{profile}} > 0 \\
25 & \text{no history} \;\land\; A_t > 5000 \\
0 & \text{otherwise}
\end{cases}
$$

### 5.3 First-Strike Bonus

$$
\text{FirstStrike} = \begin{cases}
25 & \text{first\_strike} \;\land\; \text{volume\_spike} \\
20 & \text{first\_strike only} \\
0 & \text{otherwise}
\end{cases}
$$

### 5.4 Sleep-and-Flash Mule Detection (v3)

Targets accounts dormant for extended periods that suddenly process transactions orders of magnitude larger than their historical average.

$$
\text{SF} = \frac{A_t}{\bar{A}_{\text{profile}}}
$$

$$
\text{SleepFlash} = \mathbb{1}[\text{SF} \geq 50 \;\land\; \text{days\_dormant} \geq 30] \cdot 20
$$

### 5.5 Dead Account Risk Fusion

$$
S_{\text{dead}} = \begin{cases}
\min(\text{Inactivity} + \text{Spike} + \text{FirstStrike} + \text{LowActivity} + \text{SleepFlash},\; 100) & \text{if dormant or first\_strike} \\
\text{Spike} \cdot 0.3 & \text{otherwise}
\end{cases}
$$

### 5.6 Legacy Fallback — Pass-Through Ratio

$$
PT = \frac{\text{outflow\_window}}{\text{inflow\_window}} \quad \Rightarrow \quad \text{PassThroughScore} = \min\!\left(\frac{PT}{0.80}, 1\right) \cdot 30
$$

---

## 6. Velocity & Pass-Through — Burst Calculus

**File:** `app/features/velocity.py`

### 6.1 Burst Detection

Let $\text{activity} = \text{send\_count} + \text{receive\_count}$ in 60s window:

$$
\text{Burst} = \begin{cases}
30 & \text{activity} \geq 10 \\
15 & \text{activity} \geq 5 \\
0 & \text{otherwise}
\end{cases}
$$

### 6.2 Pass-Through Score

$$
r = \frac{\text{total\_sent\_window}}{\text{total\_received\_window}}
$$

$$
\text{PassThrough} = \begin{cases}
\min\!\left(\frac{r}{1.5}, 1\right) \cdot 35 & r > 0.80 \\
10 & r > 0.50 \\
0 & \text{otherwise}
\end{cases}
$$

### 6.3 Velocity Component

$$
\text{VelocityComponent} = \min\!\left(\frac{\text{activity}}{10}, 1\right) \cdot 20
$$

### 6.4 Single Transaction Ratio

$$
\text{SingleTxRatio} = \begin{cases}
15 & \frac{A_t}{\text{total\_sent}} > 0.80 \\
0 & \text{otherwise}
\end{cases}
$$

### 6.5 Velocity Risk Fusion

$$
S_{\text{velocity}} = \min(\text{Burst} + \text{PassThrough} + \text{VelocityComponent} + \text{SingleTxRatio},\; 100)
$$

---

## 7. Indian IPv4 ASN Intelligence — 8-Step Pipeline

**File:** `app/features/asn_intelligence.py`

### Step 1 — IPv4 Validation

$$
\text{Valid}(IP) = \mathbb{1}[\text{IPv4} \;\land\; \lnot\text{Private} \;\land\; \lnot\text{Loopback} \;\land\; \lnot\text{Reserved} \;\land\; \lnot\text{LinkLocal}]
$$

### Step 2 — ASN Extraction (MMDB)

```python
reader = maxminddb.open_database("asn_ipv4_small.mmdb")
data = reader.get(ip_address)  # IP → (ASN_number, Org_name, Country)
```

### Step 3 — Indian Filter

$$
\text{ForeignFlag} = \mathbb{1}[\text{Country} \neq \text{"IN"}]
$$

### Step 4 — ASN Classification & Base Risk

| Classification | $B$ (Base Risk) |
| -------------- | --------------- |
| Mobile ISP     | 0.0             |
| Broadband      | 0.1             |
| Enterprise     | 0.3             |
| Indian Cloud   | 0.6             |
| Hosting        | 0.7             |
| Unknown (IN)   | 0.5             |
| Foreign        | 0.8             |

### Step 5 — ASN Density

$$
\hat{D} = \frac{\ln(1 + N)}{6.909} \quad \text{clamped to } [0, 1]
$$

Where $6.909 \approx \ln(1001)$.

### Step 6 — ASN Drift

$$
\delta = \mathbb{1}[\text{ASN}_t \neq \text{ASN}_{\text{mode}}]
$$

### Step 7 — ASN Switching Entropy

$$
H_{\text{ASN}} = -\sum_i p_i \ln(p_i)
$$

$$
\hat{H} = \min\!\left(\frac{H_{\text{ASN}}}{2.5}, 1\right) \quad \text{where } 2.5 \approx \ln(12)
$$

### Step 8 — Final ASN Risk Fusion

$$
R_{\text{ASN}} = \text{clamp}\!\Big(0.4 \cdot B + 0.3 \cdot \hat{D} + 0.2 \cdot \delta + 0.2 \cdot F + 0.1 \cdot \hat{H},\; 0,\; 1\Big)
$$

Scaled contribution to behavioural score: $R_{\text{ASN}} \cdot 20$ (maximum 20 points).

---

## 8. Graph Data Science Algorithms

**File:** `app/core/graph_analyzer.py` • Projection: `'fraud-graph'` • Interval: 5 seconds

### 8.1 Louvain Modularity

$$
Q = \frac{1}{2m} \sum_{ij} \left[A_{ij} - \frac{k_i k_j}{2m}\right] \delta(c_i, c_j)
$$

### 8.2 Betweenness Centrality

$$
g(v) = \sum_{s \neq v \neq t} \frac{\sigma_{st}(v)}{\sigma_{st}}
$$

### 8.3 PageRank

$$
PR(v) = \frac{1-d}{N} + d \sum_{u \in \text{in}(v)} \frac{PR(u)}{L(u)}
$$

Configuration: $d = 0.85$ (damping factor).

### 8.4 Local Clustering Coefficient

$$
C_i = \frac{2 \cdot E_i}{k_i(k_i - 1)}
$$

### 8.5 Algorithm Pipeline

| Order | Algorithm        | Property Written   |
| ----- | ---------------- | ------------------ |
| 1     | Louvain          | `community_id`     |
| 2     | Betweenness      | `betweenness`      |
| 3     | PageRank         | `pagerank`         |
| 4     | Local Clustering | `clustering_coeff` |
| 5     | WCC              | `component_id`     |

---

## 9. Anomaly Detection Primitives

**File:** `app/detection/anomaly_detection.py`

### Z-Score

$$
z = \frac{x - \bar{x}}{\sigma}
$$

Returns 0 if $|\text{values}| < 2$ or $\sigma = 0$.

### IQR Outlier

$$
\text{Outlier} = \mathbb{1}[x < Q_1 - k \cdot IQR \;\lor\; x > Q_3 + k \cdot IQR]
$$

Default: $k = 1.5$. Minimum samples: 4.

### Rolling Statistics

$$
(\bar{x}_w, \sigma_w) = \text{stats}(\text{values}[:w]) \quad \text{default } w = 25
$$

### Time Velocity

$$
V(t_{\text{ref}}, W) = |\{t_i : t_{\text{ref}} - t_i \leq W\}|
$$

### Burst Condition

$$
\text{Burst} = \mathbb{1}[V(t_{\text{ref}}, W) \geq \theta] \quad \text{defaults: } \theta = 10,\; W = 60s
$$

---

## 10. Evaluation Metrics

**File:** `app/utils/metrics.py`

### Confusion Matrix

$$
\begin{array}{c|cc}
 & \text{Predicted Fraud} & \text{Predicted Legit} \\
\hline
\text{Actual Fraud} & TP & FN \\
\text{Actual Legit} & FP & TN
\end{array}
$$

### Core Metrics

$$
\text{Precision} = \frac{TP}{TP + FP} \qquad
\text{Recall} = \frac{TP}{TP + FN} \qquad
F_1 = \frac{2 \cdot P \cdot R}{P + R}
$$

$$
\text{FPR} = \frac{FP}{FP + TN}
$$

### Latency & Throughput

| Metric       | Formula                        |
| ------------ | ------------------------------ |
| Mean Latency | $\bar{L} = \frac{1}{N}\sum L_i$ |
| P95          | $\text{percentile}(L, 95)$    |
| P99          | $\text{percentile}(L, 99)$    |
| Throughput   | $TPS = N / T_{\text{total}}$  |

---

## 11. Consolidated Symbol Reference

| Symbol | Meaning |
| ------ | ------- |
| $R$ | Final fused risk score ∈ [0, 100] |
| $S_i$ | Sub-score from extractor $i$ |
| $w_i$ | Weight for component $i$ |
| $A_t$ | Current transaction amount |
| $\bar{A}$ | Mean historical amount |
| $\sigma$ | Standard deviation |
| $z$ | Z-score |
| $Q_1, Q_3$ | First/third quartile |
| $IQR$ | Interquartile range |
| $\mathbb{1}[\cdot]$ | Indicator function (1 if true, 0 if false) |
| $d$ | Haversine distance (km) or PageRank damping factor |
| $R_{\text{ASN}}$ | ASN risk score ∈ [0, 1] |
| $H$ | Shannon entropy |
| $b$ | Betweenness centrality |
| $PR$ | PageRank score |
| $C_i$ | Local clustering coefficient |
| $Q$ | Louvain modularity |
| $N$ | Number of nodes / transactions |
| $m$ | Number of edges |

---

*For architecture, features, API reference, and deployment guide → see [README.md](README.md)*
