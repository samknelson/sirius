import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const bootstrapSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

type BootstrapFormData = z.infer<typeof bootstrapSchema>;

export default function Bootstrap() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<BootstrapFormData>({
    resolver: zodResolver(bootstrapSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
    },
  });

  const onSubmit = async (data: BootstrapFormData) => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/bootstrap", data);

      // Invalidate the bootstrap check cache to trigger redirect
      await queryClient.invalidateQueries({ queryKey: ["/api/bootstrap/needed"] });

      toast({
        title: "Bootstrap Complete!",
        description: "The admin account has been created. You can now log in with Replit using that email.",
      });

      // The Router component will automatically redirect to /login when the cache updates
    } catch (error: any) {
      toast({
        title: "Bootstrap Failed",
        description: error.message || "Failed to create admin account",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
      <Card className="w-full max-w-md" data-testid="card-bootstrap">
        <CardHeader>
          <CardTitle data-testid="heading-bootstrap">Welcome to Sirius</CardTitle>
          <CardDescription data-testid="text-bootstrap-description">
            No users exist in the system. Let's create the first administrator account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address*</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        data-testid="input-email"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      This email will be used to log in via Replit
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="John"
                        data-testid="input-firstName"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Doe"
                        data-testid="input-lastName"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-900 dark:text-blue-100">
                <p className="font-semibold mb-2">What happens next:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>An "admin" role will be created with all permissions</li>
                  <li>Your user account will be created with the admin role</li>
                  <li>You can then log in using Replit with this email</li>
                </ol>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-submit"
              >
                {isSubmitting ? "Creating Admin Account..." : "Create Admin Account"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
