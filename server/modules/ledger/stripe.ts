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
      const variable = await storage.variables.getVariableByName('stripe_payment_methods');
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

      const existingVariable = await storage.variables.getVariableByName('stripe_payment_methods');
      
      if (existingVariable) {
        await storage.variables.updateVariable(existingVariable.id, {
          name: 'stripe_payment_methods',
          value: paymentTypes,
        });
      } else {
        await storage.variables.createVariable({
          name: 'stripe_payment_methods',
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
        
        await storage.employers.updateEmployer(employer.id, {
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

  // List payment methods for an employer
  app.get("/api/employers/:id/ledger/stripe/payment-methods", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
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

      // Get payment methods from database
      const paymentMethods = await storage.ledger.stripePaymentMethods.getByEntity('employer', employerId);
      
      // Get Stripe customer ID
      const customerId = employer.stripeCustomerId;
      
      // If customer exists, fetch payment method details from Stripe
      let enrichedPaymentMethods = [];
      if (customerId) {
        const stripeClient = getStripeClient();
        
        for (const pm of paymentMethods) {
          try {
            const stripePaymentMethod = await stripeClient.paymentMethods.retrieve(pm.paymentMethod);
            enrichedPaymentMethods.push({
              ...pm,
              stripeDetails: {
                type: stripePaymentMethod.type,
                card: stripePaymentMethod.card ? {
                  brand: stripePaymentMethod.card.brand,
                  last4: stripePaymentMethod.card.last4,
                  expMonth: stripePaymentMethod.card.exp_month,
                  expYear: stripePaymentMethod.card.exp_year,
                } : null,
                us_bank_account: stripePaymentMethod.us_bank_account ? {
                  bank_name: stripePaymentMethod.us_bank_account.bank_name,
                  last4: stripePaymentMethod.us_bank_account.last4,
                  account_holder_type: stripePaymentMethod.us_bank_account.account_holder_type,
                  account_type: stripePaymentMethod.us_bank_account.account_type,
                } : null,
                billing_details: stripePaymentMethod.billing_details,
              },
            });
          } catch (error: any) {
            // If payment method no longer exists in Stripe, include it with error flag
            enrichedPaymentMethods.push({
              ...pm,
              stripeError: 'Payment method not found in Stripe',
            });
          }
        }
      } else {
        enrichedPaymentMethods = paymentMethods;
      }

      res.json(enrichedPaymentMethods);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to fetch payment methods",
        error: error.message,
      });
    }
  });

  // Create a SetupIntent for adding a payment method
  app.post("/api/employers/:id/ledger/stripe/setup-intent", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
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
      
      // Ensure customer exists
      let customerId = employer.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeClient.customers.create({
          name: employer.name,
          metadata: {
            employer_id: employer.id,
            sirius_id: employer.siriusId.toString(),
          },
        });
        customerId = customer.id;
        await storage.employers.updateEmployer(employer.id, {
          stripeCustomerId: customerId,
        });
      }

      // Get configured payment types
      const paymentTypesVariable = await storage.variables.getVariableByName('stripe_payment_methods');
      const paymentTypes = (Array.isArray(paymentTypesVariable?.value) ? paymentTypesVariable.value : ['card']) as string[];

      // Create SetupIntent for collecting payment method
      const setupIntent = await stripeClient.setupIntents.create({
        customer: customerId,
        payment_method_types: paymentTypes,
        metadata: {
          employer_id: employer.id,
        },
      });

      res.json({ 
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
      });
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to create setup intent",
        error: error.message,
      });
    }
  });

  // Attach a payment method to an employer
  app.post("/api/employers/:id/ledger/stripe/payment-methods", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
    try {
      const { id: employerId } = req.params;
      const { paymentMethodId } = req.body;
      
      if (!paymentMethodId) {
        return res.status(400).json({ message: "paymentMethodId is required" });
      }

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
      
      // Ensure customer exists
      let customerId = employer.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeClient.customers.create({
          name: employer.name,
          metadata: {
            employer_id: employer.id,
            sirius_id: employer.siriusId.toString(),
          },
        });
        customerId = customer.id;
        await storage.employers.updateEmployer(employer.id, {
          stripeCustomerId: customerId,
        });
      }

      // Attach payment method to customer in Stripe
      await stripeClient.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Check if this is the first payment method for this entity
      const existingMethods = await storage.ledger.stripePaymentMethods.getByEntity('employer', employerId);
      const isFirst = existingMethods.length === 0;

      // Save to database
      const paymentMethod = await storage.ledger.stripePaymentMethods.create({
        entityType: 'employer',
        entityId: employerId,
        paymentMethod: paymentMethodId,
        isActive: true,
        isDefault: isFirst, // Set as default if it's the first one
      });

      res.json(paymentMethod);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to attach payment method",
        error: error.message,
      });
    }
  });

  // Update payment method (enable/disable)
  app.patch("/api/employers/:id/ledger/stripe/payment-methods/:pmId", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
    try {
      const { id: employerId, pmId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ message: "isActive must be a boolean" });
      }

      const paymentMethod = await storage.ledger.stripePaymentMethods.get(pmId);
      if (!paymentMethod) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      if (paymentMethod.entityId !== employerId) {
        return res.status(403).json({ message: "Payment method does not belong to this employer" });
      }

      const updated = await storage.ledger.stripePaymentMethods.update(pmId, { isActive });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to update payment method",
        error: error.message,
      });
    }
  });

  // Set payment method as default
  app.post("/api/employers/:id/ledger/stripe/payment-methods/:pmId/set-default", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
    try {
      const { id: employerId, pmId } = req.params;

      const paymentMethod = await storage.ledger.stripePaymentMethods.get(pmId);
      if (!paymentMethod) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      if (paymentMethod.entityId !== employerId) {
        return res.status(403).json({ message: "Payment method does not belong to this employer" });
      }

      const updated = await storage.ledger.stripePaymentMethods.setAsDefault(pmId, 'employer', employerId);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to set payment method as default",
        error: error.message,
      });
    }
  });

  // Delete payment method
  app.delete("/api/employers/:id/ledger/stripe/payment-methods/:pmId", requireAccess(policies.ledgerStripeEmployer), async (req: Request, res: Response) => {
    try {
      const { id: employerId, pmId } = req.params;

      const paymentMethod = await storage.ledger.stripePaymentMethods.get(pmId);
      if (!paymentMethod) {
        return res.status(404).json({ message: "Payment method not found" });
      }

      if (paymentMethod.entityId !== employerId) {
        return res.status(403).json({ message: "Payment method does not belong to this employer" });
      }

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ 
          message: "Stripe is not configured",
          error: "STRIPE_SECRET_KEY is not set",
        });
      }

      const stripeClient = getStripeClient();
      
      // Detach payment method from Stripe customer
      try {
        await stripeClient.paymentMethods.detach(paymentMethod.paymentMethod);
      } catch (error: any) {
        // If payment method doesn't exist in Stripe, we still delete from database
        console.warn(`Failed to detach payment method from Stripe: ${error.message}`);
      }

      // Delete from database
      await storage.ledger.stripePaymentMethods.delete(pmId);
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ 
        message: "Failed to delete payment method",
        error: error.message,
      });
    }
  });
}
