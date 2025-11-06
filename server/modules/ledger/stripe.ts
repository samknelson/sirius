import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { requireAccess } from "../../accessControl";
import { policies } from "../../policies";
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
  app.get("/api/ledger/stripe/test", requireAccess(policies.ledgerStripeAdmin), async (req: Request, res: Response) => {
    try {
      const stripeClient = getStripeClient();
      
      const account = await stripeClient.accounts.retrieve();
      const balance = await stripeClient.balance.retrieve();
      
      const accountInfo = {
        connected: true,
        account: {
          id: account.id,
          email: account.email,
          country: account.country,
          defaultCurrency: account.default_currency,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          type: account.type,
        },
        balance: {
          available: balance.available,
          pending: balance.pending,
        },
        testMode: account.id?.startsWith('acct_') === false || process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'),
      };

      res.json(accountInfo);
    } catch (error: any) {
      res.status(500).json({
        connected: false,
        error: {
          message: error.message || 'Failed to connect to Stripe',
          type: error.type,
          code: error.code,
        },
      });
    }
  });

  app.get("/api/ledger/stripe/payment-types", requireAccess(policies.ledgerStripeAdmin), async (req: Request, res: Response) => {
    try {
      const variable = await storage.getVariableByName('stripe_payment_types');
      const paymentTypes = variable?.value || ['card'];
      
      res.json({ paymentTypes });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch payment types" });
    }
  });

  app.put("/api/ledger/stripe/payment-types", requireAccess(policies.ledgerStripeAdmin), async (req: Request, res: Response) => {
    try {
      const { paymentTypes } = req.body;

      if (!Array.isArray(paymentTypes)) {
        return res.status(400).json({ message: "paymentTypes must be an array" });
      }

      const validPaymentTypes = [
        'card',
        'us_bank_account',
        'acss_debit',
        'affirm',
        'afterpay_clearpay',
        'alipay',
        'au_becs_debit',
        'bacs_debit',
        'bancontact',
        'blik',
        'boleto',
        'cashapp',
        'customer_balance',
        'eps',
        'fpx',
        'giropay',
        'grabpay',
        'ideal',
        'klarna',
        'konbini',
        'link',
        'oxxo',
        'p24',
        'paynow',
        'paypal',
        'pix',
        'promptpay',
        'sepa_debit',
        'sofort',
        'wechat_pay',
      ];

      const invalidTypes = paymentTypes.filter(type => !validPaymentTypes.includes(type));
      if (invalidTypes.length > 0) {
        return res.status(400).json({ 
          message: `Invalid payment types: ${invalidTypes.join(', ')}`,
          validTypes: validPaymentTypes,
        });
      }

      const existingVariable = await storage.getVariableByName('stripe_payment_types');
      
      if (existingVariable) {
        await storage.updateVariable(existingVariable.id, {
          name: 'stripe_payment_types',
          value: paymentTypes,
        });
      } else {
        await storage.createVariable({
          name: 'stripe_payment_types',
          value: paymentTypes,
        });
      }

      res.json({ 
        paymentTypes,
        message: 'Payment types updated successfully',
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update payment types" });
    }
  });

  app.get("/api/employers/:id/ledger/stripe/customer", requireAccess(policies.ledgerStripeAdmin), async (req: Request, res: Response) => {
    try {
      const { id: employerId } = req.params;
      
      const employer = await storage.getEmployer(employerId);
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
      
      let customerId = employer.stripeCustomerId;
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
            sirius_id: employer.siriusId.toString(),
          },
        });
        
        customerId = customer.id;
        
        await storage.updateEmployer(employer.id, {
          stripeCustomerId: customerId,
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
