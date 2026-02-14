import { NextResponse } from "next/server";

interface Issue {
  severity: "critical" | "warning" | "info";
  title: string;
  explanation: string;
}

interface AIAnalysisResult {
  summary: string;
  riskVerdict: string;
  issues: Issue[];
  possibilities: string[];
  recommendation: string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      transaction_id,
      risk_score,
      amount,
      sender,
      receiver,
      city,
      status,
      features,
      triggered_rules,
      geo_evidence,
      behavioral_signature,
      graph_metrics,
    } = body;

    // ── Analyze and build issues ──
    const issues: Issue[] = [];
    const possibilities: string[] = [];

    // Risk score analysis
    if (risk_score >= 80) {
      issues.push({
        severity: "critical",
        title: "Extremely High Risk Score",
        explanation: `This transaction scored ${risk_score}/100, placing it in the highest risk category. Multiple fraud indicators are firing simultaneously, suggesting coordinated fraudulent activity.`,
      });
    } else if (risk_score >= 60) {
      issues.push({
        severity: "warning",
        title: "Elevated Risk Score",
        explanation: `This transaction scored ${risk_score}/100, above the standard threshold of 60. While not definitively fraudulent, it requires closer examination.`,
      });
    }

    // Geographic analysis
    if (geo_evidence) {
      if (geo_evidence.is_impossible) {
        issues.push({
          severity: "critical",
          title: "Physically Impossible Location Change",
          explanation: `The device is showing in ${geo_evidence.device_city} while the IP address resolves to ${geo_evidence.ip_city}, ${geo_evidence.distance_km?.toFixed(0)}km away. Moving at ${geo_evidence.speed_kmh?.toFixed(0)} km/h between these locations is physically impossible, strongly indicating the use of a VPN, proxy server, or that the account has been compromised.`,
        });
      } else if (geo_evidence.distance_km > 100) {
        issues.push({
          severity: "warning",
          title: "Notable Geographic Discrepancy",
          explanation: `There is a ${geo_evidence.distance_km?.toFixed(0)}km gap between the device location (${geo_evidence.device_city}) and IP address (${geo_evidence.ip_city}). This could indicate the use of a VPN or that the person is travelling.`,
        });
      }
    }

    // Graph network analysis
    if (graph_metrics) {
      if (graph_metrics.cycle_detected) {
        issues.push({
          severity: "critical",
          title: "Circular Money Flow Detected",
          explanation: `Our network analysis found money flowing in a circular pattern — funds are being passed through multiple accounts and eventually returning near their starting point. This is a classic money laundering technique called "layering" and involves ${graph_metrics.nodes_count} connected accounts.`,
        });
      }
      if (graph_metrics.reachability > 3) {
        issues.push({
          severity: "warning",
          title: "Unusually Connected Network",
          explanation: `This account connects to ${graph_metrics.reachability?.toFixed(1)}x more accounts than typical users. High connectivity often indicates a hub account in a fraud network that coordinates transactions between many participants.`,
        });
      }
      if (graph_metrics.circularity > 0.5) {
        issues.push({
          severity: "warning",
          title: "High Circularity Pattern",
          explanation: `${(graph_metrics.circularity * 100).toFixed(0)}% of the transaction paths in this network show circular patterns, meaning money is being moved in ways designed to obscure its origin and destination.`,
        });
      }
      if (graph_metrics.hop_velocity > 5000) {
        issues.push({
          severity: "warning",
          title: "Rapid Fund Movement Through Network",
          explanation: `Funds are moving through the network at ₹${graph_metrics.hop_velocity?.toLocaleString()}/minute across hops. This speed suggests automated or pre-coordinated transfers rather than normal human transaction behavior.`,
        });
      }
    }

    // Behavioral analysis
    if (behavioral_signature) {
      if (behavioral_signature.velocityBurst > 70) {
        issues.push({
          severity: "warning",
          title: "Sudden Activity Surge",
          explanation: `This account is suddenly making transactions much faster than its historical pattern (velocity burst: ${behavioral_signature.velocityBurst}/100). This kind of sudden spike often precedes an account being drained by a fraudster.`,
        });
      }
      if (behavioral_signature.fanInRatio > 60) {
        issues.push({
          severity: "warning",
          title: "Many-to-One Fund Concentration",
          explanation: `This account is receiving money from an unusually large number of different accounts (fan-in ratio: ${behavioral_signature.fanInRatio}/100). This pattern is typical of "money mule" accounts that collect stolen funds.`,
        });
      }
      if (behavioral_signature.amountEntropy > 80) {
        issues.push({
          severity: "info",
          title: "Irregular Amount Patterns",
          explanation: `The transaction amounts associated with this account show unusual variation (entropy: ${behavioral_signature.amountEntropy}/100). Normal users tend to have more predictable spending patterns.`,
        });
      }
      if (behavioral_signature.networkDiversity > 60) {
        issues.push({
          severity: "info",
          title: "Diverse Network Origins",
          explanation: `Transactions are coming from many different network providers (ASN diversity: ${behavioral_signature.networkDiversity}/100), suggesting multiple devices or locations are being used.`,
        });
      }
    }

    // Feature-level analysis
    if (features) {
      if (features.device > 70) {
        issues.push({
          severity: "warning",
          title: "High-Risk Device",
          explanation: `The device used for this transaction has a risk score of ${features.device}/100. This could mean it's a new or previously unseen device, a rooted/jailbroken phone, or a device shared across multiple suspicious accounts.`,
        });
      }
      if (features.deadAccount > 60) {
        issues.push({
          severity: "info",
          title: "Previously Dormant Account",
          explanation: `This account was inactive for an extended period before this transaction (dead account score: ${features.deadAccount}/100). Dormant accounts that suddenly become active are sometimes compromised accounts being used for fraud.`,
        });
      }
    }

    // Triggered rules
    if (triggered_rules) {
      for (const rule of triggered_rules) {
        if (rule.severity === "CRITICAL" && !issues.some((i) => i.title === rule.rule)) {
          issues.push({
            severity: "critical",
            title: rule.rule,
            explanation: rule.detail,
          });
        }
      }
    }

    // ── Generate possibilities ──
    if (amount > 50000)
      possibilities.push("This large-value transaction could be a legitimate business payment, investment, or alternatively a high-value fraud attempt");
    if (risk_score >= 60 && risk_score < 80)
      possibilities.push("The borderline risk score could be a false positive — unusual but legitimate activity like travel, device change, or a one-time large purchase");
    possibilities.push("If this sender regularly transacts with this receiver, this may be a normal recurring payment that triggered rules due to a change in device or location");
    possibilities.push("The receiver account should be checked independently to see if similar patterns exist with other senders");
    if (graph_metrics?.cycle_detected)
      possibilities.push("The circular flow pattern could indicate a coordinated money laundering operation or, less likely, a legitimate business with complex internal transfers");
    if (status === "BLOCKED")
      possibilities.push("This transaction was already blocked by the automated system. Review whether the block was appropriate or if it was a false positive affecting a legitimate customer.");
    possibilities.push("Consider checking the sender's recent transaction history for similar patterns before making a final determination");

    // ── Build verdict and summary ──
    const critCount = issues.filter((i) => i.severity === "critical").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;

    const riskVerdict =
      critCount >= 2
        ? "HIGH RISK — Immediate Action Required"
        : critCount === 1
        ? "ELEVATED — Review Recommended"
        : warnCount >= 2
        ? "MODERATE — Monitor Closely"
        : "LOW — Within Normal Parameters";

    const summary =
      critCount >= 2
        ? `This transaction between ${sender?.name || "Unknown"} and ${receiver?.name || "Unknown"} in ${city || "Unknown City"} for ₹${amount?.toLocaleString() || "N/A"} has triggered ${critCount} critical alerts and ${warnCount} warnings. The combination of ${issues
            .filter((i) => i.severity === "critical")
            .slice(0, 2)
            .map((i) => i.title.toLowerCase())
            .join(" and ")} presents a strong fraud signal that requires immediate investigation.`
        : critCount === 1
        ? `A critical issue was identified in this ₹${amount?.toLocaleString() || "N/A"} transaction: ${issues.find((i) => i.severity === "critical")?.title.toLowerCase()}. Along with ${warnCount} additional warnings, this transaction warrants a manual review by your fraud team.`
        : warnCount >= 2
        ? `This ₹${amount?.toLocaleString() || "N/A"} transaction from ${sender?.name || "Unknown"} shows ${warnCount} warning-level indicators. While no single factor is conclusive, the combined pattern suggests heightened risk that should be monitored.`
        : `This transaction appears to be within normal parameters. Only ${issues.length} minor observation(s) were noted, none requiring immediate action.`;

    const recommendation =
      critCount >= 2
        ? "Immediately block this transaction and freeze both the sender and receiver accounts pending investigation. Alert your compliance team, document all findings, and file a suspicious activity report (SAR) with the relevant authorities within 24 hours."
        : critCount === 1
        ? "Place this transaction on hold for manual review. Contact the sender through their verified phone number to confirm the transaction details. If they cannot verify, escalate to your fraud investigation team."
        : warnCount >= 2
        ? "Allow this transaction to proceed but add both accounts to your enhanced monitoring list for the next 30 days. Set up alerts for any further unusual activity from either party."
        : "No immediate action required. The transaction can proceed normally. Continue standard monitoring through your existing fraud detection systems.";

    const result: AIAnalysisResult = {
      summary,
      riskVerdict,
      issues,
      possibilities,
      recommendation,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("AI Analysis error:", err);
    return NextResponse.json(
      { error: "Failed to analyze transaction", detail: err.message },
      { status: 500 }
    );
  }
}
