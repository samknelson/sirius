import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { requireAccess } from "../../services/access-policy-evaluator";
import { storage } from "../../storage";

let stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function registerLedgerStripeRoutes(app: Express) {

  app.get("/api/employers/:id/ledger/stripe/customer", requireAccess('ledger.stripe.employer', (req) => req.params.id), async (req: Request, res: Response) => {
    try {
      const { id: employerId } = req.params;
      
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        return res.status(404).json({ message: "Employer not found" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ 
          message: "Stripe is not configured",
          error: "STRIPE_SECRET_KEY is not set",
        });
      }

      const stripeClient = getStripeClient();

      // Interim: resolve the single enabled Stripe gateway config so the
      // customer mapping has a config to key on. Full provider-generic
      // generalization of this route is a follow-up task.
      const stripeGateways = await storage.pluginConfigs.getByTypeAndPlugin('payment-gateway', 'stripe');
      const enabledGateways = stripeGateways.filter((g) => g.enabled);
      if (enabledGateways.length === 0) {
        return res.status(409).json({ message: "No enabled Stripe payment gateway is configured" });
      }
      if (enabledGateways.length > 1) {
        return res.status(409).json({
          message: "Multiple enabled Stripe payment gateways are configured; expected exactly one",
        });
      }
      const gatewayConfigId = enabledGateways[0].id;

      const mapping = await storage.ledger.gatewayCustomers.get('employer', employerId, gatewayConfigId);
      let customerId: string | null = mapping?.customerRef ?? null;
      let customer: Stripe.Customer | null = null;
      let wasRecreated = false;
      
      if (customerId) {
        try {
          customer = await stripeClient.customers.retrieve(customerId) as Stripe.Customer;
          if (customer.deleted) {
            customerId = null;
            customer = null;
            wasRecreated = true;
          }
        } catch (error: any) {
          if (error.code === 'resource_missing') {
            customerId = null;
            customer = null;
            wasRecreated = true;
          } else {
            throw error;
          }
        }
      }
      
      if (!customer) {
        customer = await stripeClient.customers.create({
          name: employer.name,
          metadata: {
            employer_id: employer.id,
            sirius_id: employer.siriusId?.toString() ?? '',
          },
        });
        
        customerId = customer.id;
        
        await storage.ledger.gatewayCustomers.upsert({
          entityType: 'employer',
          entityId: employerId,
          gatewayConfigId,
          customerRef: customerId,
        });
      }
      
      const stripeBaseUrl = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') 
        ? 'https://dashboard.stripe.com/test' 
        : 'https://dashboard.stripe.com';

      res.json({
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          created: customer.created,
          currency: customer.currency,
          balance: customer.balance,
          delinquent: customer.delinquent,
        },
        stripeUrl: `${stripeBaseUrl}/customers/${customer.id}`,
        wasRecreated,
      });
    } catch (error: any) {
      if (error.message?.includes('STRIPE_SECRET_KEY')) {
        return res.status(503).json({ 
          message: "Stripe is not configured",
          error: error.message,
        });
      }
      res.status(500).json({ 
        message: "Failed to fetch Stripe customer",
        error: error.message,
      });
    }
  });

}
