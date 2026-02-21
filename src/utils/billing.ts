import { PRODUCT_IDS } from './referral.js';
import type { IUsers } from '../schemas/users.schema.js';

type BillingAction = 'auto' | 'new' | 'upgrade' | 'change' | 'reactivate';
type BillingScenario = 'new' | 'upgrade' | 'change' | 'returning_winback' | 'reactivate' | 'active_no_change';
type PlanTier = 'free' | 'premium' | 'pro';

interface DiscountLike {
    id: string;
    code?: string | null;
    type?: 'fixed' | 'percentage' | string;
    basis_points?: number;
    amount?: number;
    products?: Array<{ id?: string }>;
}

interface PolarListResponse<T> {
    items?: T[];
}

interface PolarSubscription {
    id: string;
    status: string;
    product_id?: string;
    ended_at?: string | null;
    canceled_at?: string | null;
    ends_at?: string | null;
}

interface CheckoutCreateRequest {
    user: IUsers;
    targetPlan: Exclude<PlanTier, 'free'>;
    action?: BillingAction;
    promoCode?: string;
    successUrl?: string;
    returnUrl?: string;
    referralCode?: string;
}

interface BillingContext {
    planTier: PlanTier;
    hasActiveSubscription: boolean;
    hasAnySubscriptionHistory: boolean;
    inactivityMonths: number;
    isWinbackEligible: boolean;
    scenario: BillingScenario;
    activeSubscriptionId?: string;
    activeProductId?: string;
    targetProductId?: string;
    isReferralEligible: boolean;
}

interface CheckoutDecision {
    scenario: BillingScenario;
    selectedDiscountId: string | null;
    selectedDiscountCode: string | null;
    selectedDiscountReason: 'referral' | 'promo' | 'winback' | 'upgrade' | 'change' | null;
    checkoutId: string;
    checkoutUrl: string;
    allowDiscountCodes: boolean;
}

interface CreatePortalSessionRequest {
    user: IUsers;
    returnUrl?: string;
}

interface PortalSessionResponse {
    sessionId: string;
    url: string;
    expiresAt?: string;
}

const PLAN_PRODUCT_MAP: Record<Exclude<PlanTier, 'free'>, string> = {
    premium: PRODUCT_IDS.PREMIUM,
    pro: PRODUCT_IDS.PRO
};

const PLAN_RANK: Record<PlanTier, number> = {
    free: 0,
    premium: 1,
    pro: 2
};

const WINBACK_MONTHS = 6;

class PolarApiError extends Error {
    readonly status: number;
    readonly body: string;

    constructor(status: number, body: string) {
        super(`Polar API error ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}

function isUuidV4(value: string | null | undefined): boolean {
    if (!value) return false;

    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function getPolarBaseUrl(): string {
    if (process.env.POLARSH_API_BASE_URL) {
        return process.env.POLARSH_API_BASE_URL.replace(/\/$/, '');
    }

    if (process.env.POLARSH_ENVIRONMENT === 'sandbox') {
        return 'https://sandbox-api.polar.sh';
    }

    return 'https://api.polar.sh';
}

function getPolarToken(): string {
    const token = process.env.POLARSH_OAT;
    if (!token) {
        throw new Error('POLARSH_OAT is not set');
    }
    return token;
}

async function polarRequest<T>(path: string, init: RequestInit): Promise<T> {
    const token = getPolarToken();
    const baseUrl = getPolarBaseUrl();

    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init.headers || {})
        }
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new PolarApiError(response.status, errorBody);
    }

    return await response.json() as T;
}

function toDate(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function diffMonths(fromDate: Date, toDate: Date): number {
    const yearDiff = toDate.getUTCFullYear() - fromDate.getUTCFullYear();
    const monthDiff = toDate.getUTCMonth() - fromDate.getUTCMonth();
    const total = yearDiff * 12 + monthDiff;

    if (toDate.getUTCDate() < fromDate.getUTCDate()) {
        return Math.max(0, total - 1);
    }

    return Math.max(0, total);
}

function getLastActivityDate(user: IUsers): Date | null {
    const lastActivity = toDate(user.last_app_activity_at);
    if (lastActivity) return lastActivity;
    return toDate(user.updated_at);
}

function getDefaultUrl(envVar: string): string | null {
    const value = process.env[envVar];
    if (!value) return null;
    try {
        const parsed = new URL(value);
        return parsed.toString();
    } catch {
        return null;
    }
}

function isAllowedHost(url: URL): boolean {
    const allowList = process.env.BILLING_ALLOWED_REDIRECT_HOSTS;
    if (!allowList) return true;

    const allowedHosts = allowList
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);

    if (allowedHosts.length === 0) return true;

    return allowedHosts.includes(url.host.toLowerCase());
}

function sanitizeRedirectUrl(rawUrl: string | undefined, fallbackEnv: string): string | null {
    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            if (isAllowedHost(parsed)) {
                return parsed.toString();
            }
        } catch {
            return getDefaultUrl(fallbackEnv);
        }
    }

    return getDefaultUrl(fallbackEnv);
}

function getDiscountConfigByScenario(scenario: BillingScenario): string | null {
    switch (scenario) {
        case 'returning_winback':
            return process.env.POLARSH_WINBACK_DISCOUNT_ID || null;
        case 'upgrade':
            return process.env.POLARSH_UPGRADE_DISCOUNT_ID || null;
        case 'change':
            return process.env.POLARSH_CHANGE_DISCOUNT_ID || null;
        default:
            return null;
    }
}

function extractPriceAmountCents(price: any): number {
    const candidates = [
        price?.amount,
        price?.price_amount,
        price?.fixed_amount,
        price?.unit_amount
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            return candidate;
        }
    }

    return 0;
}

async function getProductBaseAmount(productId: string): Promise<number> {
    try {
        const product = await polarRequest<any>(`/v1/products/${productId}/`, {
            method: 'GET'
        });

        const prices = Array.isArray(product?.prices) ? product.prices : [];
        let bestAmount = 0;

        for (const price of prices) {
            const amount = extractPriceAmountCents(price);
            if (amount > bestAmount) {
                bestAmount = amount;
            }
        }

        return bestAmount;
    } catch {
        return 0;
    }
}

async function listSubscriptions(customerId: string, active?: boolean): Promise<PolarSubscription[]> {
    const params = new URLSearchParams();
    params.set('customer_id', customerId);
    params.set('limit', '100');

    if (typeof active === 'boolean') {
        params.set('active', String(active));
    }

    const response = await polarRequest<PolarListResponse<PolarSubscription>>(`/v1/subscriptions/?${params.toString()}`, {
        method: 'GET'
    });

    return response.items || [];
}

async function getDiscountById(discountId: string): Promise<DiscountLike | null> {
    if (!discountId) return null;

    try {
        return await polarRequest<DiscountLike>(`/v1/discounts/${discountId}/`, {
            method: 'GET'
        });
    } catch {
        return null;
    }
}

function isDiscountApplicableToProduct(discount: DiscountLike, productId: string): boolean {
    if (!Array.isArray(discount.products) || discount.products.length === 0) {
        return true;
    }

    return discount.products.some((product) => product.id === productId);
}

async function findDiscountByPromoCode(code: string, productId: string): Promise<DiscountLike | null> {
    const queryCode = code.trim().toLowerCase();
    if (!queryCode) return null;

    const params = new URLSearchParams();
    params.set('query', queryCode);
    params.set('limit', '100');

    const response = await polarRequest<PolarListResponse<DiscountLike>>(`/v1/discounts/?${params.toString()}`, {
        method: 'GET'
    });

    const items = response.items || [];
    const discount = items.find((item) => item.code?.toLowerCase() === queryCode);

    if (!discount) return null;
    if (!isDiscountApplicableToProduct(discount, productId)) return null;

    return discount;
}

function estimateDiscountValue(discount: DiscountLike, productBaseAmount: number): number {
    if (discount.type === 'fixed') {
        return discount.amount || 0;
    }

    if (discount.type === 'percentage') {
        const basisPoints = discount.basis_points || 0;
        if (productBaseAmount > 0) {
            return Math.floor(productBaseAmount * (basisPoints / 10000));
        }
        return basisPoints;
    }

    return 0;
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'string') {
            if (!value.trim()) {
                continue;
            }
            result[key] = value;
            continue;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            result[key] = value;
        }
    }

    return result;
}

function selectBestDiscount(candidates: Array<{ reason: CheckoutDecision['selectedDiscountReason']; discount: DiscountLike }>, productBaseAmount: number): { reason: CheckoutDecision['selectedDiscountReason']; discount: DiscountLike } | null {
    if (candidates.length === 0) return null;

    let best = candidates[0];
    let bestValue = estimateDiscountValue(best.discount, productBaseAmount);

    for (const candidate of candidates.slice(1)) {
        const candidateValue = estimateDiscountValue(candidate.discount, productBaseAmount);
        if (candidateValue > bestValue) {
            best = candidate;
            bestValue = candidateValue;
        }
    }

    return best;
}

function inferScenario({
    requestedAction,
    hasActiveSubscription,
    targetPlan,
    currentPlan,
    winbackEligible,
    hasAnySubscriptionHistory
}: {
    requestedAction: BillingAction;
    hasActiveSubscription: boolean;
    targetPlan: Exclude<PlanTier, 'free'>;
    currentPlan: PlanTier;
    winbackEligible: boolean;
    hasAnySubscriptionHistory: boolean;
}): BillingScenario {
    if (requestedAction !== 'auto') {
        if (requestedAction === 'new') return 'new';
        if (requestedAction === 'upgrade') return 'upgrade';
        if (requestedAction === 'change') return 'change';
        return winbackEligible ? 'returning_winback' : 'reactivate';
    }

    if (hasActiveSubscription) {
        if (targetPlan === currentPlan) {
            return 'active_no_change';
        }

        if (PLAN_RANK[targetPlan] > PLAN_RANK[currentPlan]) {
            return 'upgrade';
        }

        return 'change';
    }

    if (hasAnySubscriptionHistory && winbackEligible) {
        return 'returning_winback';
    }

    return hasAnySubscriptionHistory ? 'reactivate' : 'new';
}

function getCurrentPlanFromActiveSubscription(userPlan: PlanTier, activeProductId?: string): PlanTier {
    if (activeProductId === PRODUCT_IDS.PRO) return 'pro';
    if (activeProductId === PRODUCT_IDS.PREMIUM) return 'premium';
    return userPlan;
}

export async function getBillingContext(
    user: IUsers,
    targetPlan?: Exclude<PlanTier, 'free'>,
    requestedAction: BillingAction = 'auto'
): Promise<BillingContext> {
    const inactivityMonths = (() => {
        const lastActivityDate = getLastActivityDate(user);
        if (!lastActivityDate) return WINBACK_MONTHS + 1;
        return diffMonths(lastActivityDate, new Date());
    })();

    const isWinbackEligible = inactivityMonths >= WINBACK_MONTHS;
    const customerId = user.polar_sh_customer_id;

    if (!customerId) {
        return {
            planTier: user.plan_tier,
            hasActiveSubscription: false,
            hasAnySubscriptionHistory: false,
            inactivityMonths,
            isWinbackEligible,
            scenario: inferScenario({
                requestedAction,
                hasActiveSubscription: false,
                targetPlan: targetPlan || 'premium',
                currentPlan: user.plan_tier,
                winbackEligible: isWinbackEligible,
                hasAnySubscriptionHistory: false
            }),
            targetProductId: targetPlan ? PLAN_PRODUCT_MAP[targetPlan] : undefined,
            isReferralEligible: Boolean(user.referralCodeUsed)
        };
    }

    const [activeSubscriptions, allSubscriptions] = await Promise.all([
        listSubscriptions(customerId, true),
        listSubscriptions(customerId)
    ]);

    const activeSubscription = activeSubscriptions[0];
    const hasActiveSubscription = Boolean(activeSubscription);
    const hasAnySubscriptionHistory = allSubscriptions.length > 0;
    const activeProductId = activeSubscription?.product_id;
    const currentPlan = getCurrentPlanFromActiveSubscription(user.plan_tier, activeProductId);

    const scenario = inferScenario({
        requestedAction,
        hasActiveSubscription,
        targetPlan: targetPlan || 'premium',
        currentPlan,
        winbackEligible: isWinbackEligible,
        hasAnySubscriptionHistory
    });

    return {
        planTier: currentPlan,
        hasActiveSubscription,
        hasAnySubscriptionHistory,
        inactivityMonths,
        isWinbackEligible,
        scenario,
        activeSubscriptionId: activeSubscription?.id,
        activeProductId,
        targetProductId: targetPlan ? PLAN_PRODUCT_MAP[targetPlan] : undefined,
        isReferralEligible: Boolean(user.referralCodeUsed)
    };
}

export async function createBillingCheckout(request: CheckoutCreateRequest): Promise<CheckoutDecision> {
    const targetProductId = PLAN_PRODUCT_MAP[request.targetPlan];
    const action = request.action || 'auto';
    const context = await getBillingContext(request.user, request.targetPlan, action);

    if (context.scenario === 'active_no_change') {
        throw new Error('You are already subscribed to this plan.');
    }

    const discountCandidates: Array<{ reason: CheckoutDecision['selectedDiscountReason']; discount: DiscountLike }> = [];

    if ((request.user.referralCodeUsed || request.referralCode) && process.env.POLARSH_REFERRAL_DISCOUNT_ID) {
        const referralDiscount = await getDiscountById(process.env.POLARSH_REFERRAL_DISCOUNT_ID);
        if (referralDiscount && isDiscountApplicableToProduct(referralDiscount, targetProductId)) {
            discountCandidates.push({ reason: 'referral', discount: referralDiscount });
        }
    }

    if (request.promoCode) {
        const promoDiscount = await findDiscountByPromoCode(request.promoCode, targetProductId);
        if (!promoDiscount) {
            throw new Error('Invalid or inapplicable promo code for the selected plan.');
        }
        discountCandidates.push({ reason: 'promo', discount: promoDiscount });
    }

    const scenarioDiscountId = getDiscountConfigByScenario(context.scenario);
    if (scenarioDiscountId) {
        const scenarioDiscount = await getDiscountById(scenarioDiscountId);
        if (scenarioDiscount && isDiscountApplicableToProduct(scenarioDiscount, targetProductId)) {
            const reason: CheckoutDecision['selectedDiscountReason'] =
                context.scenario === 'returning_winback'
                    ? 'winback'
                    : context.scenario === 'upgrade'
                        ? 'upgrade'
                        : context.scenario === 'change'
                            ? 'change'
                            : null;

            if (reason) {
                discountCandidates.push({ reason, discount: scenarioDiscount });
            }
        }
    }

    const productBaseAmount = await getProductBaseAmount(targetProductId);
    const bestDiscount = selectBestDiscount(discountCandidates, productBaseAmount);

    const successUrl = sanitizeRedirectUrl(request.successUrl, 'BILLING_SUCCESS_URL');
    const returnUrl = sanitizeRedirectUrl(request.returnUrl, 'BILLING_RETURN_URL');

    const allowDiscountCodes = (() => {
        if (context.scenario === 'upgrade' || context.scenario === 'change') {
            return false;
        }
        return !bestDiscount;
    })();

    const idempotencyKey = `billing:${request.user._id.toString()}:${request.targetPlan}:${context.scenario}:${Date.now()}`;

    const validCustomerId = isUuidV4(request.user.polar_sh_customer_id)
        ? request.user.polar_sh_customer_id
        : undefined;

    const metadata = compactMetadata({
        source: 'dimabot_billing',
        scenario: context.scenario,
        target_plan: request.targetPlan,
        current_plan: context.planTier,
        inactivity_months: context.inactivityMonths,
        selected_discount_reason: bestDiscount?.reason,
        selected_discount_code: bestDiscount?.discount.code,
        user_id: request.user._id.toString()
    });

    const checkoutPayload: Record<string, unknown> = {
        products: [targetProductId],
        customer_id: validCustomerId,
        external_customer_id: request.user._id.toString(),
        customer_email: request.user.email,
        customer_name: request.user.name,
        allow_discount_codes: allowDiscountCodes,
        discount_id: bestDiscount?.discount.id,
        metadata
    };

    if (successUrl) checkoutPayload.success_url = successUrl;
    if (returnUrl) checkoutPayload.return_url = returnUrl;

    const createCheckout = async (payload: Record<string, unknown>) => {
        return await polarRequest<any>('/v1/checkouts/', {
            method: 'POST',
            headers: {
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify(payload)
        });
    };

    let checkout: any;
    try {
        checkout = await createCheckout(checkoutPayload);
    } catch (err) {
        if (
            err instanceof PolarApiError &&
            err.status === 422 &&
            typeof checkoutPayload.customer_id === 'string' &&
            checkoutPayload.customer_id.length > 0
        ) {
            const fallbackPayload = { ...checkoutPayload };
            delete fallbackPayload.customer_id;

            console.warn('[BILLING/CHECKOUT] Retrying checkout without customer_id after Polar 422', {
                userId: request.user._id.toString(),
                customerId: checkoutPayload.customer_id,
                targetPlan: request.targetPlan,
                scenario: context.scenario,
                polarError: err.body,
                timestamp: new Date().toISOString()
            });

            checkout = await createCheckout(fallbackPayload);
        } else {
            throw err;
        }
    }

    return {
        scenario: context.scenario,
        selectedDiscountId: bestDiscount?.discount.id || null,
        selectedDiscountCode: bestDiscount?.discount.code || null,
        selectedDiscountReason: bestDiscount?.reason || null,
        checkoutId: checkout.id,
        checkoutUrl: checkout.url,
        allowDiscountCodes
    };
}

export async function createCustomerPortalSession(request: CreatePortalSessionRequest): Promise<PortalSessionResponse> {
    if (!request.user.polar_sh_customer_id) {
        throw new Error('Customer does not have a Polar customer ID.');
    }

    const returnUrl = sanitizeRedirectUrl(request.returnUrl, 'BILLING_PORTAL_RETURN_URL');

    const payload: Record<string, unknown> = {
        customer_id: request.user.polar_sh_customer_id
    };

    if (returnUrl) {
        payload.return_url = returnUrl;
    }

    const session = await polarRequest<any>('/v1/customer-sessions/', {
        method: 'POST',
        body: JSON.stringify(payload)
    });

    return {
        sessionId: session.id,
        url: session.customer_portal_url,
        expiresAt: session.expires_at
    };
}
