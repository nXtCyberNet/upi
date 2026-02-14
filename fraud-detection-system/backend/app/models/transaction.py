"""
Pydantic models for transactions, users, and devices.
Shared across the entire backend.

Schema v2 — nested structure matching real UPI gateway payloads.
"""

from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from datetime import datetime
from enum import Enum
import uuid


# ══════════════════════════════════════════════════════════════
# Enums
# ══════════════════════════════════════════════════════════════

class TransactionChannel(str, Enum):
    UPI = "UPI"
    NEFT = "NEFT"
    IMPS = "IMPS"


class TxnType(str, Enum):
    """UPI transaction purpose."""
    PAY = "PAY"
    COLLECT = "COLLECT"
    MANDATE = "MANDATE"
    REFUND = "REFUND"


class DeviceType(str, Enum):
    """Device platform."""
    ANDROID = "ANDROID"
    IOS = "IOS"
    WEB = "WEB"
    UNKNOWN = "UNKNOWN"


class CredentialType(str, Enum):
    """Authentication credential type."""
    PIN = "PIN"
    OTP = "OTP"
    BIOMETRIC = "BIOMETRIC"
    PATTERN = "PATTERN"


class CredentialSubType(str, Enum):
    """Credential sub-type."""
    MPIN = "MPIN"
    SMS_OTP = "SMS_OTP"
    FINGERPRINT = "FINGERPRINT"
    FACE = "FACE"
    IRIS = "IRIS"
    DRAW_PATTERN = "DRAW_PATTERN"


class ReceiverType(str, Enum):
    """Receiver entity type."""
    PERSON = "PERSON"
    MERCHANT = "MERCHANT"
    BILLER = "BILLER"
    SELF = "SELF"


class IPASNType(str, Enum):
    MOBILE_ISP = "MOBILE_ISP"
    BROADBAND = "BROADBAND"
    ENTERPRISE = "ENTERPRISE"
    INDIAN_CLOUD = "INDIAN_CLOUD"
    HOSTING = "HOSTING"
    FOREIGN = "FOREIGN"
    UNKNOWN = "UNKNOWN"


class TransactionStatus(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FLAGGED = "FLAGGED"
    BLOCKED = "BLOCKED"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# ══════════════════════════════════════════════════════════════
# Nested Sub-Models (v2 schema)
# ══════════════════════════════════════════════════════════════

class SenderDevice(BaseModel):
    """Device fingerprint for the sender."""
    device_id: str = Field(..., description="Stable UUID of the physical device")
    device_os: Optional[str] = None
    device_type: DeviceType = DeviceType.UNKNOWN
    app_version: Optional[str] = None
    capability_mask: Optional[str] = Field(
        None, description="Binary bitmask of device capabilities, e.g. '011001'"
    )


class SenderNetwork(BaseModel):
    """Network metadata for the sender."""
    ip_address: Optional[str] = None


class SenderGeo(BaseModel):
    """Geolocation of the sender at transaction time."""
    lat: Optional[float] = None
    lon: Optional[float] = None


class Sender(BaseModel):
    """Sender entity with nested device, network, and geo info."""
    sender_id: str
    upi_id: Optional[str] = None
    device: Optional[SenderDevice] = None
    network: Optional[SenderNetwork] = None
    geo: Optional[SenderGeo] = None


class Credential(BaseModel):
    """Authentication credential used for this transaction."""
    type: CredentialType = CredentialType.PIN
    sub_type: Optional[CredentialSubType] = None


class Receiver(BaseModel):
    """Receiver entity."""
    receiver_id: str
    upi_id: Optional[str] = None
    receiver_type: ReceiverType = ReceiverType.PERSON
    mcc_code: Optional[str] = Field(
        None, description="Merchant Category Code (only for MERCHANT receivers)"
    )


# ══════════════════════════════════════════════════════════════
# Transaction Input (v2 — nested schema)
# ══════════════════════════════════════════════════════════════

class TransactionInput(BaseModel):
    """Incoming transaction payload from UPI gateway / simulator.

    v2 schema: nested sender/receiver/credential structure matching
    real-world UPI switch payloads.
    """
    tx_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    amount: float = Field(gt=0)
    currency: str = "INR"
    txn_type: TxnType = TxnType.PAY

    sender: Sender
    credential: Optional[Credential] = None
    receiver: Receiver

    # ── Convenience accessors (flatten for downstream code) ──

    @property
    def sender_id(self) -> str:
        return self.sender.sender_id

    @property
    def receiver_id(self) -> str:
        return self.receiver.receiver_id

    @property
    def device_id(self) -> str:
        """Stable device UUID — primary device key (replaces device_hash)."""
        if self.sender.device:
            return self.sender.device.device_id
        return "UNKNOWN_DEVICE"

    @property
    def device_hash(self) -> str:
        """Alias for device_id for backward compatibility."""
        return self.device_id

    @property
    def device_os(self) -> Optional[str]:
        if self.sender.device:
            return self.sender.device.device_os
        return None

    @property
    def device_type(self) -> DeviceType:
        if self.sender.device:
            return self.sender.device.device_type
        return DeviceType.UNKNOWN

    @property
    def app_version(self) -> Optional[str]:
        if self.sender.device:
            return self.sender.device.app_version
        return None

    @property
    def capability_mask(self) -> Optional[str]:
        if self.sender.device:
            return self.sender.device.capability_mask
        return None

    @property
    def ip_address(self) -> Optional[str]:
        if self.sender.network:
            return self.sender.network.ip_address
        return None

    @property
    def sender_lat(self) -> Optional[float]:
        if self.sender.geo:
            return self.sender.geo.lat
        return None

    @property
    def sender_lon(self) -> Optional[float]:
        if self.sender.geo:
            return self.sender.geo.lon
        return None

    @property
    def upi_id_sender(self) -> Optional[str]:
        return self.sender.upi_id

    @property
    def upi_id_receiver(self) -> Optional[str]:
        return self.receiver.upi_id

    @property
    def receiver_type(self) -> ReceiverType:
        return self.receiver.receiver_type

    @property
    def mcc_code(self) -> Optional[str]:
        return self.receiver.mcc_code

    @property
    def credential_type(self) -> Optional[CredentialType]:
        if self.credential:
            return self.credential.type
        return None

    @property
    def credential_sub_type(self) -> Optional[CredentialSubType]:
        if self.credential:
            return self.credential.sub_type
        return None

    @property
    def channel(self) -> TransactionChannel:
        """UPI transactions are always UPI channel."""
        return TransactionChannel.UPI


class TransactionResult(BaseModel):
    """Full processing result returned to the caller."""
    tx_id: str
    sender_id: str
    receiver_id: str
    amount: float
    timestamp: datetime
    risk_score: float
    risk_level: RiskLevel
    status: TransactionStatus
    processing_time_ms: float
    breakdown: dict
    flags: List[str] = []
    cluster_id: Optional[str] = None


# ══════════════════════════════════════════════════════════════
# User / Device Models
# ══════════════════════════════════════════════════════════════

class UserProfile(BaseModel):
    """User behavioural profile stored on the :User node.

    Focuses on behavioral anchors for fraud detection.
    Compliant with DPDP Act — no Sensitive Personal Data stored.
    """
    user_id: str
    upi_id: Optional[str] = None
    avg_tx_amount: float = 0.0
    std_tx_amount: float = 0.0
    tx_count: int = 0
    total_outflow: float = 0.0
    last_active: Optional[datetime] = None
    is_dormant: bool = False
    risk_score: float = 0.0
    last_lat: Optional[float] = None
    last_lon: Optional[float] = None
    city: Optional[str] = None
    kyc_status: str = "VERIFIED"


class DeviceInfo(BaseModel):
    """Device fingerprint information stored on the :Device node."""
    device_id: str
    device_hash: Optional[str] = None  # legacy alias
    os: Optional[str] = None
    device_type: DeviceType = DeviceType.UNKNOWN
    app_version: Optional[str] = None
    capability_mask: Optional[str] = None
    device_score: float = 0.0
    account_count: int = 0
