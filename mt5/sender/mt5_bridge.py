#!/usr/bin/env python3
"""
PipSight Pro — MT5 Python Sender

Always-on Windows sender for the isolated Pattern Detector MT5 receiver.

Responsibilities:
- Connect to the locally installed MetaTrader 5 terminal.
- Resolve canonical symbols to broker symbols without guessing.
- Read live bid/ask ticks.
- Read fully closed candles for every approved timeframe.
- Build the exact MT5 bridge payload.
- Sign the raw JSON body with HMAC-SHA256.
- Preserve request identity during retries.
- Persist session and monotonic sequence state atomically.

This sender does not modify the existing Twelve Data signal pipeline, Signal
Engine, Pattern Detection, AI confidence, learning, Telegram, tracker logic,
or existing JSON outputs.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import os
import secrets
import signal
import ssl
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SCHEMA_VERSION = "1.0.0"
SOURCE_NAME = "MT5_BROKER"
AUTH_VERSION = "1.0.0"

DEFAULT_RECEIVER_URL = "http://127.0.0.1:8787/v1/ingest/mt5"
DEFAULT_BRIDGE_ID = "pipsight-mt5-bridge"
DEFAULT_POLL_SECONDS = 5.0
DEFAULT_HTTP_TIMEOUT_SECONDS = 15.0
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_BASE_SECONDS = 2.0
DEFAULT_STATE_FILENAME = ".mt5-bridge-state.json"
MINIMUM_SECRET_LENGTH = 32

CANONICAL_SYMBOLS: Tuple[str, ...] = (
    "GBPJPY",
    "XAUUSD",
)

TIMEFRAME_MINUTES: Mapping[str, int] = {
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1H": 60,
    "4H": 240,
}

HEADER_NAMES: Mapping[str, str] = {
    "bridge_id": "X-Bridge-Id",
    "timestamp": "X-Timestamp",
    "nonce": "X-Nonce",
    "signature": "X-Signature",
    "payload_hash": "X-Payload-Hash",
    "auth_version": "X-Auth-Version",
}


class BridgeError(RuntimeError):
    """Base sender error."""


class ConfigurationError(BridgeError):
    """Invalid or incomplete sender configuration."""


class Mt5ConnectionError(BridgeError):
    """MetaTrader 5 connection or terminal-state failure."""


class SymbolMappingError(BridgeError):
    """Canonical-to-broker symbol mapping failure."""


class MarketDataError(BridgeError):
    """Tick or candle retrieval/validation failure."""


class ReceiverError(BridgeError):
    """Receiver request or response failure."""


@dataclass(frozen=True)
class Config:
    receiver_url: str
    shared_secret: str
    bridge_id: str
    terminal_path: Optional[str]
    poll_seconds: float
    http_timeout_seconds: float
    max_retries: int
    retry_base_seconds: float
    state_path: Path
    symbol_overrides: Mapping[str, str]
    allow_insecure_remote_http: bool
    once: bool
    log_level: str

    @classmethod
    def from_environment(
        cls,
        *,
        once: bool = False,
        log_level_override: Optional[str] = None,
    ) -> "Config":
        receiver_url = _non_empty(
            os.getenv("MT5_RECEIVER_URL")
        ) or DEFAULT_RECEIVER_URL

        shared_secret = _non_empty(
            os.getenv("MT5_SHARED_SECRET")
        )
        if shared_secret is None:
            raise ConfigurationError(
                "MT5_SHARED_SECRET is required"
            )
        if len(shared_secret) < MINIMUM_SECRET_LENGTH:
            raise ConfigurationError(
                f"MT5_SHARED_SECRET must be at least "
                f"{MINIMUM_SECRET_LENGTH} characters"
            )

        bridge_id = _non_empty(
            os.getenv("MT5_BRIDGE_ID")
        ) or DEFAULT_BRIDGE_ID
        _validate_identifier(
            bridge_id,
            "MT5_BRIDGE_ID",
        )

        terminal_path = _non_empty(
            os.getenv("MT5_TERMINAL_PATH")
        )

        poll_seconds = _positive_float(
            os.getenv("MT5_POLL_SECONDS"),
            DEFAULT_POLL_SECONDS,
            "MT5_POLL_SECONDS",
        )
        http_timeout_seconds = _positive_float(
            os.getenv("MT5_HTTP_TIMEOUT_SECONDS"),
            DEFAULT_HTTP_TIMEOUT_SECONDS,
            "MT5_HTTP_TIMEOUT_SECONDS",
        )
        max_retries = _non_negative_int(
            os.getenv("MT5_MAX_RETRIES"),
            DEFAULT_MAX_RETRIES,
            "MT5_MAX_RETRIES",
        )
        retry_base_seconds = _positive_float(
            os.getenv("MT5_RETRY_BASE_SECONDS"),
            DEFAULT_RETRY_BASE_SECONDS,
            "MT5_RETRY_BASE_SECONDS",
        )

        state_raw = _non_empty(
            os.getenv("MT5_SENDER_STATE_PATH")
        )
        if state_raw:
            state_path = Path(state_raw).expanduser().resolve()
        else:
            state_path = (
                Path(__file__).resolve().parent
                / DEFAULT_STATE_FILENAME
            )

        symbol_overrides: Dict[str, str] = {}
        for canonical in CANONICAL_SYMBOLS:
            override = _non_empty(
                os.getenv(f"MT5_SYMBOL_{canonical}")
            )
            if override:
                symbol_overrides[canonical] = override

        allow_insecure_remote_http = (
            _boolean(
                os.getenv(
                    "MT5_ALLOW_INSECURE_REMOTE_HTTP"
                ),
                False,
                "MT5_ALLOW_INSECURE_REMOTE_HTTP",
            )
        )

        _validate_receiver_url(
            receiver_url,
            allow_insecure_remote_http=(
                allow_insecure_remote_http
            ),
        )

        log_level = (
            log_level_override
            or _non_empty(
                os.getenv("MT5_SENDER_LOG_LEVEL")
            )
            or "INFO"
        ).upper()

        if log_level not in {
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        }:
            raise ConfigurationError(
                "MT5_SENDER_LOG_LEVEL is invalid"
            )

        return cls(
            receiver_url=receiver_url,
            shared_secret=shared_secret,
            bridge_id=bridge_id,
            terminal_path=terminal_path,
            poll_seconds=poll_seconds,
            http_timeout_seconds=(
                http_timeout_seconds
            ),
            max_retries=max_retries,
            retry_base_seconds=(
                retry_base_seconds
            ),
            state_path=state_path,
            symbol_overrides=(
                dict(symbol_overrides)
            ),
            allow_insecure_remote_http=(
                allow_insecure_remote_http
            ),
            once=once,
            log_level=log_level,
        )


@dataclass
class PersistentState:
    session_id: str
    sequence: int

    @classmethod
    def load_or_create(
        cls,
        path: Path,
    ) -> "PersistentState":
        if path.exists():
            try:
                data = json.loads(
                    path.read_text(
                        encoding="utf-8"
                    )
                )
            except (
                OSError,
                json.JSONDecodeError,
            ) as exc:
                raise ConfigurationError(
                    f"Unable to read sender state: "
                    f"{path}: {exc}"
                ) from exc

            session_id = data.get(
                "sessionId"
            )
            sequence = data.get(
                "sequence"
            )

            if (
                not isinstance(
                    session_id,
                    str,
                )
                or not session_id
                or not isinstance(
                    sequence,
                    int,
                )
                or sequence < 0
            ):
                raise ConfigurationError(
                    f"Sender state is invalid: {path}"
                )

            return cls(
                session_id=session_id,
                sequence=sequence,
            )

        state = cls(
            session_id=(
                f"session-{uuid.uuid4()}"
            ),
            sequence=0,
        )
        state.save(path)
        return state

    def next_sequence(
        self,
        path: Path,
    ) -> int:
        self.sequence += 1
        self.save(path)
        return self.sequence

    def save(
        self,
        path: Path,
    ) -> None:
        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        payload = {
            "sessionId": self.session_id,
            "sequence": self.sequence,
            "updatedAtUtc": utc_now_iso(),
        }

        file_descriptor: Optional[int] = None
        temporary_path: Optional[Path] = None

        try:
            file_descriptor, temporary_name = (
                tempfile.mkstemp(
                    prefix=(
                        f".{path.name}."
                    ),
                    suffix=".tmp",
                    dir=str(path.parent),
                    text=True,
                )
            )
            temporary_path = Path(
                temporary_name
            )

            with os.fdopen(
                file_descriptor,
                "w",
                encoding="utf-8",
                newline="\n",
            ) as handle:
                file_descriptor = None
                json.dump(
                    payload,
                    handle,
                    indent=2,
                    sort_keys=True,
                )
                handle.write("\n")
                handle.flush()
                os.fsync(
                    handle.fileno()
                )

            os.replace(
                temporary_path,
                path,
            )
            temporary_path = None
        finally:
            if file_descriptor is not None:
                os.close(
                    file_descriptor
                )
            if (
                temporary_path is not None
                and temporary_path.exists()
            ):
                try:
                    temporary_path.unlink()
                except OSError:
                    pass


@dataclass(frozen=True)
class PendingRequest:
    body: bytes
    headers: Mapping[str, str]
    request_id: str
    sequence: int


class MetaTraderAdapter:
    """Lazy wrapper around the official MetaTrader5 Python package."""

    def __init__(
        self,
        terminal_path: Optional[str],
    ) -> None:
        self.terminal_path = terminal_path
        self.mt5: Any = None
        self.timeframe_values: Dict[str, Any] = {}

    def connect(self) -> None:
        try:
            import MetaTrader5 as mt5  # type: ignore
        except ImportError as exc:
            raise Mt5ConnectionError(
                "MetaTrader5 package is not installed. "
                "Install it on the Windows MT5 host."
            ) from exc

        self.mt5 = mt5

        if self.terminal_path:
            initialized = mt5.initialize(
                self.terminal_path
            )
        else:
            initialized = mt5.initialize()

        if not initialized:
            raise Mt5ConnectionError(
                "MetaTrader 5 initialize() failed: "
                f"{mt5.last_error()}"
            )

        self.timeframe_values = {
            "5m": mt5.TIMEFRAME_M5,
            "15m": mt5.TIMEFRAME_M15,
            "30m": mt5.TIMEFRAME_M30,
            "1H": mt5.TIMEFRAME_H1,
            "4H": mt5.TIMEFRAME_H4,
        }

        terminal_info = mt5.terminal_info()
        if terminal_info is None:
            self.disconnect()
            raise Mt5ConnectionError(
                "MetaTrader 5 terminal_info() "
                f"failed: {mt5.last_error()}"
            )

        if not bool(
            getattr(
                terminal_info,
                "connected",
                False,
            )
        ):
            self.disconnect()
            raise Mt5ConnectionError(
                "MetaTrader 5 terminal is not "
                "connected to the broker"
            )

        if mt5.account_info() is None:
            self.disconnect()
            raise Mt5ConnectionError(
                "MetaTrader 5 account is not "
                "connected"
            )

    def disconnect(self) -> None:
        if self.mt5 is not None:
            try:
                self.mt5.shutdown()
            finally:
                self.mt5 = None
                self.timeframe_values = {}

    def terminal_snapshot(
        self,
    ) -> Dict[str, Any]:
        self._require_connection()

        terminal_info = self.mt5.terminal_info()
        account_info = self.mt5.account_info()

        if terminal_info is None:
            raise Mt5ConnectionError(
                "terminal_info() failed: "
                f"{self.mt5.last_error()}"
            )

        connected = bool(
            getattr(
                terminal_info,
                "connected",
                False,
            )
        )
        account_connected = (
            account_info is not None
        )

        return {
            "connected": connected,
            "accountConnected": (
                account_connected
            ),
            "heartbeatAtUtc": (
                utc_now_iso()
            ),
            "terminalName": (
                _optional_string(
                    getattr(
                        terminal_info,
                        "name",
                        None,
                    )
                )
                or "MetaTrader 5"
            ),
            "brokerCompany": (
                _optional_string(
                    getattr(
                        account_info,
                        "company",
                        None,
                    )
                )
                if account_info
                else None
            ),
            "brokerServer": (
                _optional_string(
                    getattr(
                        account_info,
                        "server",
                        None,
                    )
                )
                if account_info
                else None
            ),
        }

    def resolve_symbols(
        self,
        overrides: Mapping[str, str],
    ) -> Dict[str, str]:
        self._require_connection()

        symbols = self.mt5.symbols_get()
        if symbols is None:
            raise SymbolMappingError(
                "symbols_get() failed: "
                f"{self.mt5.last_error()}"
            )

        available = sorted(
            {
                str(symbol.name)
                for symbol in symbols
                if getattr(
                    symbol,
                    "name",
                    None,
                )
            }
        )

        resolved: Dict[str, str] = {}

        for canonical in CANONICAL_SYMBOLS:
            override = overrides.get(
                canonical
            )

            if override:
                if override not in available:
                    raise SymbolMappingError(
                        f"Configured broker symbol "
                        f"{override!r} for {canonical} "
                        f"does not exist in MT5"
                    )
                broker_symbol = override
            else:
                broker_symbol = (
                    resolve_broker_symbol(
                        canonical,
                        available,
                    )
                )

            if not self.mt5.symbol_select(
                broker_symbol,
                True,
            ):
                raise SymbolMappingError(
                    f"symbol_select({broker_symbol!r}) "
                    f"failed: {self.mt5.last_error()}"
                )

            resolved[canonical] = (
                broker_symbol
            )

        return resolved

    def symbol_snapshot(
        self,
        canonical: str,
        broker_symbol: str,
    ) -> Dict[str, Any]:
        self._require_connection()

        info = self.mt5.symbol_info(
            broker_symbol
        )
        if info is None:
            raise MarketDataError(
                f"symbol_info({broker_symbol!r}) "
                f"failed: {self.mt5.last_error()}"
            )

        point = float(
            getattr(
                info,
                "point",
                0.0,
            )
        )
        digits = int(
            getattr(
                info,
                "digits",
                -1,
            )
        )

        if point <= 0:
            raise MarketDataError(
                f"{broker_symbol} has invalid point"
            )
        if digits < 0 or digits > 10:
            raise MarketDataError(
                f"{broker_symbol} has invalid digits"
            )

        tick = self._tick_snapshot(
            canonical,
            broker_symbol,
            point,
        )

        candles: Dict[str, Any] = {}
        for timeframe in TIMEFRAME_MINUTES:
            candles[timeframe] = (
                self._closed_candle_snapshot(
                    canonical,
                    broker_symbol,
                    timeframe,
                )
            )

        return {
            "canonicalSymbol": canonical,
            "brokerSymbol": broker_symbol,
            "digits": digits,
            "point": point,
            "tradeMode": str(
                getattr(
                    info,
                    "trade_mode",
                    "",
                )
            ),
            "tick": tick,
            "candles": candles,
        }

    def _tick_snapshot(
        self,
        canonical: str,
        broker_symbol: str,
        point: float,
    ) -> Dict[str, Any]:
        tick = self.mt5.symbol_info_tick(
            broker_symbol
        )
        if tick is None:
            raise MarketDataError(
                f"symbol_info_tick("
                f"{broker_symbol!r}) failed: "
                f"{self.mt5.last_error()}"
            )

        bid = float(
            getattr(tick, "bid", 0.0)
        )
        ask = float(
            getattr(tick, "ask", 0.0)
        )

        if bid <= 0 or ask <= 0:
            raise MarketDataError(
                f"{broker_symbol} tick has "
                "non-positive bid/ask"
            )
        if ask < bid:
            raise MarketDataError(
                f"{broker_symbol} tick ask is "
                "lower than bid"
            )

        time_msc = int(
            getattr(
                tick,
                "time_msc",
                0,
            )
        )
        if time_msc <= 0:
            time_seconds = int(
                getattr(
                    tick,
                    "time",
                    0,
                )
            )
            time_msc = (
                time_seconds * 1000
            )

        if time_msc <= 0:
            raise MarketDataError(
                f"{broker_symbol} tick has "
                "invalid timestamp"
            )

        last_raw = float(
            getattr(
                tick,
                "last",
                0.0,
            )
        )
        last_value: Optional[float] = (
            last_raw
            if last_raw > 0
            else None
        )

        volume_real = float(
            getattr(
                tick,
                "volume_real",
                0.0,
            )
        )
        volume = (
            volume_real
            if volume_real >= 0
            else 0.0
        )

        spread_points = (
            (ask - bid) / point
        )

        return {
            "canonicalSymbol": canonical,
            "brokerSymbol": broker_symbol,
            "bid": bid,
            "ask": ask,
            "last": last_value,
            "volume": volume,
            "timeUtc": epoch_ms_to_iso(
                time_msc
            ),
            "timeMsc": time_msc,
            "spreadPoints": max(
                0.0,
                spread_points,
            ),
            "receivedAtUtc": (
                utc_now_iso()
            ),
        }

    def _closed_candle_snapshot(
        self,
        canonical: str,
        broker_symbol: str,
        timeframe: str,
    ) -> Dict[str, Any]:
        mt5_timeframe = (
            self.timeframe_values[
                timeframe
            ]
        )

        rates = self.mt5.copy_rates_from_pos(
            broker_symbol,
            mt5_timeframe,
            1,
            1,
        )

        if rates is None or len(rates) != 1:
            raise MarketDataError(
                f"copy_rates_from_pos("
                f"{broker_symbol!r}, "
                f"{timeframe}, 1, 1) failed: "
                f"{self.mt5.last_error()}"
            )

        row = rates[0]

        open_time_seconds = int(
            row["time"]
        )
        duration_seconds = (
            TIMEFRAME_MINUTES[
                timeframe
            ]
            * 60
        )
        close_time_seconds = (
            open_time_seconds
            + duration_seconds
        )

        open_price = float(row["open"])
        high_price = float(row["high"])
        low_price = float(row["low"])
        close_price = float(row["close"])

        if min(
            open_price,
            high_price,
            low_price,
            close_price,
        ) <= 0:
            raise MarketDataError(
                f"{broker_symbol} {timeframe} "
                "candle contains a non-positive "
                "OHLC value"
            )

        if high_price < low_price:
            raise MarketDataError(
                f"{broker_symbol} {timeframe} "
                "candle high is lower than low"
            )

        if not (
            low_price
            <= open_price
            <= high_price
        ):
            raise MarketDataError(
                f"{broker_symbol} {timeframe} "
                "candle open is outside range"
            )

        if not (
            low_price
            <= close_price
            <= high_price
        ):
            raise MarketDataError(
                f"{broker_symbol} {timeframe} "
                "candle close is outside range"
            )

        return {
            "canonicalSymbol": canonical,
            "brokerSymbol": broker_symbol,
            "timeframe": timeframe,
            "openTimeUtc": (
                epoch_seconds_to_iso(
                    open_time_seconds
                )
            ),
            "closeTimeUtc": (
                epoch_seconds_to_iso(
                    close_time_seconds
                )
            ),
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "tickVolume": int(
                row["tick_volume"]
            ),
            "realVolume": int(
                row["real_volume"]
            ),
            "spread": int(
                row["spread"]
            ),
            "closed": True,
        }

    def _require_connection(
        self,
    ) -> None:
        if self.mt5 is None:
            raise Mt5ConnectionError(
                "MetaTrader 5 is not connected"
            )


class ReceiverClient:
    def __init__(
        self,
        config: Config,
    ) -> None:
        self.config = config

    def build_pending_request(
        self,
        payload: Mapping[str, Any],
        *,
        request_id: str,
        sequence: int,
    ) -> PendingRequest:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")

        timestamp = utc_now_iso()
        nonce = secrets.token_hex(24)
        payload_hash = hashlib.sha256(
            body
        ).hexdigest()

        request_path = receiver_request_path(
            self.config.receiver_url
        )

        canonical = "\n".join(
            (
                "POST",
                request_path,
                timestamp,
                nonce,
                payload_hash,
            )
        )

        signature = hmac.new(
            self.config.shared_secret.encode(
                "utf-8"
            ),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        headers = {
            HEADER_NAMES[
                "bridge_id"
            ]: self.config.bridge_id,
            HEADER_NAMES[
                "timestamp"
            ]: timestamp,
            HEADER_NAMES[
                "nonce"
            ]: nonce,
            HEADER_NAMES[
                "signature"
            ]: signature,
            HEADER_NAMES[
                "payload_hash"
            ]: payload_hash,
            HEADER_NAMES[
                "auth_version"
            ]: AUTH_VERSION,
            "Content-Type": (
                "application/json; "
                "charset=utf-8"
            ),
            "Content-Length": str(
                len(body)
            ),
            "User-Agent": (
                "PipSight-MT5-Bridge/1.0"
            ),
        }

        return PendingRequest(
            body=body,
            headers=headers,
            request_id=request_id,
            sequence=sequence,
        )

    def send_with_retry(
        self,
        pending: PendingRequest,
    ) -> Mapping[str, Any]:
        attempts = (
            self.config.max_retries
            + 1
        )
        last_error: Optional[Exception] = None

        for attempt in range(attempts):
            try:
                return self._send_once(
                    pending
                )
            except ReceiverError as exc:
                last_error = exc

                if attempt >= attempts - 1:
                    break

                delay = (
                    self.config
                    .retry_base_seconds
                    * (2**attempt)
                )
                logging.warning(
                    "Receiver request %s failed "
                    "(attempt %s/%s): %s; "
                    "retrying in %.1fs",
                    pending.request_id,
                    attempt + 1,
                    attempts,
                    exc,
                    delay,
                )
                time.sleep(delay)

        assert last_error is not None
        raise last_error

    def _send_once(
        self,
        pending: PendingRequest,
    ) -> Mapping[str, Any]:
        request = Request(
            self.config.receiver_url,
            data=pending.body,
            headers=dict(
                pending.headers
            ),
            method="POST",
        )

        context = (
            ssl.create_default_context()
            if self.config.receiver_url
            .lower()
            .startswith("https://")
            else None
        )

        try:
            with urlopen(
                request,
                timeout=(
                    self.config
                    .http_timeout_seconds
                ),
                context=context,
            ) as response:
                raw = response.read()
                status = int(
                    response.status
                )
        except HTTPError as exc:
            response_body = (
                exc.read()
                .decode(
                    "utf-8",
                    errors="replace",
                )
            )
            raise ReceiverError(
                f"Receiver returned HTTP "
                f"{exc.code}: "
                f"{response_body[:1000]}"
            ) from exc
        except URLError as exc:
            raise ReceiverError(
                f"Receiver connection failed: "
                f"{exc.reason}"
            ) from exc
        except TimeoutError as exc:
            raise ReceiverError(
                "Receiver request timed out"
            ) from exc
        except OSError as exc:
            raise ReceiverError(
                f"Receiver request failed: {exc}"
            ) from exc

        if status not in (200, 202):
            raise ReceiverError(
                f"Unexpected receiver status: "
                f"{status}"
            )

        try:
            decoded = json.loads(
                raw.decode("utf-8")
            )
        except (
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as exc:
            raise ReceiverError(
                "Receiver returned invalid JSON"
            ) from exc

        if not isinstance(decoded, dict):
            raise ReceiverError(
                "Receiver response must be "
                "a JSON object"
            )

        if decoded.get("ok") is not True:
            raise ReceiverError(
                "Receiver did not confirm success"
            )

        return decoded


class BridgeApplication:
    def __init__(
        self,
        config: Config,
    ) -> None:
        self.config = config
        self.state = (
            PersistentState.load_or_create(
                config.state_path
            )
        )
        self.adapter = (
            MetaTraderAdapter(
                config.terminal_path
            )
        )
        self.client = (
            ReceiverClient(config)
        )
        self.stop_requested = False
        self.symbol_mapping: Dict[
            str,
            str,
        ] = {}

    def request_stop(
        self,
        signum: int,
        _frame: Any,
    ) -> None:
        logging.info(
            "Stop requested by signal %s",
            signum,
        )
        self.stop_requested = True

    def run(self) -> int:
        self.adapter.connect()

        try:
            self.symbol_mapping = (
                self.adapter
                .resolve_symbols(
                    self.config
                    .symbol_overrides
                )
            )

            logging.info(
                "Resolved broker symbols: %s",
                self.symbol_mapping,
            )

            while not self.stop_requested:
                started = time.monotonic()

                try:
                    self.publish_once()
                except BridgeError:
                    logging.exception(
                        "MT5 bridge cycle failed"
                    )
                    if self.config.once:
                        return 1

                if self.config.once:
                    return 0

                elapsed = (
                    time.monotonic()
                    - started
                )
                sleep_seconds = max(
                    0.0,
                    self.config.poll_seconds
                    - elapsed,
                )
                self._interruptible_sleep(
                    sleep_seconds
                )

            return 0
        finally:
            self.adapter.disconnect()

    def publish_once(self) -> None:
        sequence = (
            self.state.next_sequence(
                self.config.state_path
            )
        )
        request_id = (
            f"request-{uuid.uuid4()}"
        )

        payload = self.build_payload(
            request_id=request_id,
            sequence=sequence,
        )

        pending = (
            self.client
            .build_pending_request(
                payload,
                request_id=request_id,
                sequence=sequence,
            )
        )

        response = (
            self.client
            .send_with_retry(
                pending
            )
        )

        logging.info(
            "Published request=%s "
            "sequence=%s duplicate=%s",
            request_id,
            sequence,
            bool(
                response.get(
                    "duplicate",
                    False,
                )
            ),
        )

    def build_payload(
        self,
        *,
        request_id: str,
        sequence: int,
    ) -> Dict[str, Any]:
        terminal = (
            self.adapter
            .terminal_snapshot()
        )

        if (
            not terminal["connected"]
            or not terminal[
                "accountConnected"
            ]
        ):
            raise Mt5ConnectionError(
                "MT5 terminal/account is not "
                "connected"
            )

        symbols: Dict[str, Any] = {}

        for canonical in CANONICAL_SYMBOLS:
            broker_symbol = (
                self.symbol_mapping[
                    canonical
                ]
            )
            symbols[canonical] = (
                self.adapter
                .symbol_snapshot(
                    canonical,
                    broker_symbol,
                )
            )

        return {
            "schemaVersion": (
                SCHEMA_VERSION
            ),
            "source": SOURCE_NAME,
            "bridgeId": (
                self.config.bridge_id
            ),
            "sessionId": (
                self.state.session_id
            ),
            "requestId": request_id,
            "sequence": sequence,
            "generatedAtUtc": (
                utc_now_iso()
            ),
            "terminal": terminal,
            "symbols": symbols,
        }

    def _interruptible_sleep(
        self,
        seconds: float,
    ) -> None:
        deadline = (
            time.monotonic()
            + seconds
        )

        while (
            not self.stop_requested
            and time.monotonic()
            < deadline
        ):
            time.sleep(
                min(
                    0.5,
                    max(
                        0.0,
                        deadline
                        - time.monotonic(),
                    ),
                )
            )


def resolve_broker_symbol(
    canonical: str,
    available_symbols: Iterable[str],
) -> str:
    canonical_upper = canonical.upper()

    names = sorted(
        {
            str(name)
            for name in available_symbols
            if str(name).strip()
        }
    )

    exact = [
        name
        for name in names
        if name.upper()
        == canonical_upper
    ]

    if len(exact) == 1:
        return exact[0]

    canonical_compact = (
        alphanumeric_upper(
            canonical_upper
        )
    )

    candidates = [
        name
        for name in names
        if (
            alphanumeric_upper(name)
            .startswith(
                canonical_compact
            )
            or alphanumeric_upper(name)
            .endswith(
                canonical_compact
            )
        )
    ]

    if len(candidates) == 1:
        return candidates[0]

    if not candidates:
        raise SymbolMappingError(
            f"No broker symbol found for "
            f"{canonical}. Configure "
            f"MT5_SYMBOL_{canonical}."
        )

    raise SymbolMappingError(
        f"Multiple broker symbols match "
        f"{canonical}: {candidates}. "
        f"Configure MT5_SYMBOL_{canonical} "
        "explicitly."
    )


def alphanumeric_upper(
    value: str,
) -> str:
    return "".join(
        character
        for character in value.upper()
        if character.isalnum()
    )


def receiver_request_path(
    receiver_url: str,
) -> str:
    parsed = urlparse(
        receiver_url
    )
    path = parsed.path or "/"

    if parsed.query:
        path = (
            f"{path}?{parsed.query}"
        )

    return path


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(
            timespec="milliseconds"
        )
        .replace("+00:00", "Z")
    )


def epoch_ms_to_iso(
    epoch_ms: int,
) -> str:
    return (
        datetime.fromtimestamp(
            epoch_ms / 1000,
            tz=timezone.utc,
        )
        .isoformat(
            timespec="milliseconds"
        )
        .replace("+00:00", "Z")
    )


def epoch_seconds_to_iso(
    epoch_seconds: int,
) -> str:
    return (
        datetime.fromtimestamp(
            epoch_seconds,
            tz=timezone.utc,
        )
        .isoformat(
            timespec="milliseconds"
        )
        .replace("+00:00", "Z")
    )


def _validate_receiver_url(
    receiver_url: str,
    *,
    allow_insecure_remote_http: bool,
) -> None:
    parsed = urlparse(
        receiver_url
    )

    if parsed.scheme not in {
        "http",
        "https",
    }:
        raise ConfigurationError(
            "MT5_RECEIVER_URL must use "
            "http or https"
        )

    if not parsed.hostname:
        raise ConfigurationError(
            "MT5_RECEIVER_URL must include "
            "a hostname"
        )

    if not parsed.path:
        raise ConfigurationError(
            "MT5_RECEIVER_URL must include "
            "the ingest path"
        )

    local_hosts = {
        "127.0.0.1",
        "localhost",
        "::1",
    }

    if (
        parsed.scheme == "http"
        and parsed.hostname
        not in local_hosts
        and not allow_insecure_remote_http
    ):
        raise ConfigurationError(
            "Remote MT5_RECEIVER_URL must "
            "use HTTPS. Set "
            "MT5_ALLOW_INSECURE_REMOTE_HTTP=true "
            "only for an explicitly approved "
            "private test environment."
        )


def _validate_identifier(
    value: str,
    field_name: str,
) -> None:
    allowed = set(
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789._:-"
    )

    if (
        len(value) > 128
        or any(
            character not in allowed
            for character in value
        )
    ):
        raise ConfigurationError(
            f"{field_name} contains "
            "invalid characters"
        )


def _non_empty(
    value: Optional[str],
) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _optional_string(
    value: Any,
) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _positive_float(
    value: Optional[str],
    fallback: float,
    field_name: str,
) -> float:
    if _non_empty(value) is None:
        return fallback

    try:
        number = float(
            str(value)
        )
    except ValueError as exc:
        raise ConfigurationError(
            f"{field_name} must be numeric"
        ) from exc

    if number <= 0:
        raise ConfigurationError(
            f"{field_name} must be positive"
        )

    return number


def _non_negative_int(
    value: Optional[str],
    fallback: int,
    field_name: str,
) -> int:
    if _non_empty(value) is None:
        return fallback

    try:
        number = int(
            str(value)
        )
    except ValueError as exc:
        raise ConfigurationError(
            f"{field_name} must be an integer"
        ) from exc

    if number < 0:
        raise ConfigurationError(
            f"{field_name} must be "
            "non-negative"
        )

    return number


def _boolean(
    value: Optional[str],
    fallback: bool,
    field_name: str,
) -> bool:
    normalized = _non_empty(value)

    if normalized is None:
        return fallback

    lowered = normalized.lower()

    if lowered == "true":
        return True
    if lowered == "false":
        return False

    raise ConfigurationError(
        f"{field_name} must be true or false"
    )


def configure_logging(
    level: str,
) -> None:
    logging.basicConfig(
        level=getattr(
            logging,
            level,
        ),
        format=(
            "%(asctime)s %(levelname)s "
            "%(message)s"
        ),
    )


def parse_arguments(
    argv: Optional[Sequence[str]] = None,
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Send broker-native MT5 ticks "
            "and closed candles to the "
            "PipSight MT5 receiver."
        )
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help=(
            "Publish one payload and exit."
        ),
    )
    parser.add_argument(
        "--log-level",
        choices=(
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ),
        help=(
            "Override MT5_SENDER_LOG_LEVEL."
        ),
    )
    return parser.parse_args(argv)


def main(
    argv: Optional[Sequence[str]] = None,
) -> int:
    arguments = parse_arguments(
        argv
    )

    try:
        config = Config.from_environment(
            once=arguments.once,
            log_level_override=(
                arguments.log_level
            ),
        )
        configure_logging(
            config.log_level
        )

        application = (
            BridgeApplication(config)
        )

        signal.signal(
            signal.SIGINT,
            application.request_stop,
        )
        if hasattr(
            signal,
            "SIGTERM",
        ):
            signal.signal(
                signal.SIGTERM,
                application.request_stop,
            )

        logging.info(
            "Starting PipSight MT5 sender "
            "bridgeId=%s receiver=%s",
            config.bridge_id,
            config.receiver_url,
        )

        return application.run()
    except BridgeError as exc:
        logging.error(
            "MT5 sender failed: %s",
            exc,
        )
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
