"""payments: the third service in the checkout chain (orders-api -> inventory-api -> payments)."""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
import uuid
from typing import Any

import redis
import sentry_sdk
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from opentelemetry import metrics, trace
from pydantic import BaseModel

SERVICE = "payments"
ENVIRONMENT = os.environ.get("APP_ENV", "demo")
RELEASE = os.environ.get("APP_RELEASE", "dev")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(SERVICE)


def before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    span = trace.get_current_span()
    if span and span.get_span_context().is_valid:
        span_context = span.get_span_context()
        event.setdefault("contexts", {}).setdefault(
            "trace",
            {
                "trace_id": trace.format_trace_id(span_context.trace_id),
                "span_id": trace.format_span_id(span_context.span_id),
            },
        )
    return event


dsn = os.environ.get("BS_ERRORS_DSN") or None
if dsn:
    sentry_sdk.init(
        dsn=dsn,
        environment=ENVIRONMENT,
        release=RELEASE,
        traces_sample_rate=0,  # OpenTelemetry owns tracing; Sentry only ships exceptions
        send_default_pii=True,
        before_send=before_send,
    )
    sentry_sdk.set_tag("service", SERVICE)
else:
    log.warning("BS_ERRORS_DSN not set; payments runs without error tracking")

app = FastAPI(title="bsdemo payments")
meter = metrics.get_meter(SERVICE)
charges_total = meter.create_counter("payments.charges", description="Charge attempts by outcome")
charge_amount = meter.create_histogram("payments.amount", unit="cents", description="Charged amounts")

_redis = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"), decode_responses=True)
_chaos_cache: dict[str, tuple[float, dict[str, str]]] = {}
STARTED_AT = time.time()


def chaos_flags(service: str = "payments") -> dict[str, str]:
    now = time.time()
    hit = _chaos_cache.get(service)
    if hit and now - hit[0] < 1.0:
        return hit[1]
    try:
        flags = _redis.hgetall(f"chaos:{service}")
    except Exception as exc:  # noqa: BLE001 - chaos flags are best effort
        log.warning("could not read chaos flags: %s", exc)
        flags = {}
    _chaos_cache[service] = (now, flags)
    return flags


class ChargeRequest(BaseModel):
    order_id: str
    amount_cents: int
    currency: str = "USD"
    user_id: str = "guest"
    card: str = "4242"
    chaos: str = ""


@app.middleware("http")
async def user_context(request: Request, call_next):
    user_id = request.headers.get("x-user-id", "guest")
    user_name = request.headers.get("x-user-name", "Guest")
    span = trace.get_current_span()
    if span:
        span.set_attribute("enduser.id", user_id)
        span.set_attribute("user.plan", request.headers.get("x-user-plan", "free"))
    if dsn:
        sentry_sdk.set_user({"id": user_id, "username": user_name})
    started = time.perf_counter()
    response = await call_next(request)
    if not request.url.path.startswith("/health"):
        log.info(
            "request completed method=%s path=%s status=%s duration_ms=%.1f user_id=%s",
            request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000, user_id,
        )
    return response


@app.get("/health")
async def health():
    if chaos_flags().get("health_fail") == "1":
        log.warning("health check failing on purpose (chaos health_fail)")
        return JSONResponse(status_code=503, content={"status": "failing", "service": SERVICE, "reason": "chaos:health_fail"})
    return {"status": "ok", "service": SERVICE, "uptime_s": int(time.time() - STARTED_AT), "release": RELEASE}


@app.get("/health/deep")
async def health_deep():
    try:
        _redis.ping()
        return {"status": "ok", "checks": {"redis": "ok"}}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "degraded", "checks": {"redis": str(exc)}})


@app.post("/charge", status_code=201)
async def charge(body: ChargeRequest, x_user_id: str = Header(default="guest")):
    span = trace.get_current_span()
    span.set_attribute("order.id", body.order_id)
    span.set_attribute("payment.amount_cents", body.amount_cents)
    span.set_attribute("payment.card_last4", body.card)
    flags = chaos_flags()
    mode = flags.get("mode", "ok")
    scenario = body.chaos or ""
    log.info("charge requested order_id=%s amount_cents=%s card=%s user_id=%s chaos=%s mode=%s",
             body.order_id, body.amount_cents, body.card, x_user_id, scenario or "-", mode)

    if scenario == "payments_timeout" or mode == "slow":
        # orders-api gives up after 5s -> upstream timeout in the caller, but this span still completes.
        await asyncio.sleep(8 if scenario == "payments_timeout" else 3)

    if scenario == "payments_crash" or mode == "crash":
        gateway_response = None
        # Deliberate bug: the gateway adapter assumes a response object is always present.
        raise RuntimeError(f"Chaos: payment gateway adapter crashed for order {body.order_id}: "
                           f"'NoneType' object has no attribute 'status' ({gateway_response})")

    latency_ms = 60 + random.random() * 190  # simulated gateway latency
    await asyncio.sleep(latency_ms / 1000)

    if body.card == "4000" or mode == "decline_all":
        charges_total.add(1, {"outcome": "declined"})
        log.warning("card declined order_id=%s card=%s user_id=%s", body.order_id, body.card, x_user_id)
        return JSONResponse(
            status_code=402,
            content={"error": "card_declined", "message": f"Card ending in {body.card} was declined: insufficient funds", "order_id": body.order_id},
        )

    if body.amount_cents <= 0:
        charges_total.add(1, {"outcome": "invalid"})
        return JSONResponse(status_code=400, content={"error": "invalid_amount", "message": "Amount must be positive"})

    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    charges_total.add(1, {"outcome": "captured"})
    charge_amount.record(body.amount_cents, {"currency": body.currency})
    span.set_attribute("payment.id", payment_id)
    log.info("charge captured order_id=%s payment_id=%s amount_cents=%s latency_ms=%.0f", body.order_id, payment_id, body.amount_cents, latency_ms)
    return {"payment_id": payment_id, "status": "captured", "amount_cents": body.amount_cents, "currency": body.currency}
