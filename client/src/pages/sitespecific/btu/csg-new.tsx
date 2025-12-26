import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PrefillData {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  nonBpsEmail: string | null;
  school: string | null;
}

const formSchema = z.object({
  bpsId: z.string().optional(),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  nonBpsEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  school: z.string().optional(),
  principalHeadmaster: z.string().optional(),
  role: z.string().optional(),
  typeOfClass: z.string().optional(),
  course: z.string().optional(),
  section: z.string().optional(),
  numberOfStudents: z.string().optional(),
  comments: z.string().optional(),
  status: z.string().default("pending"),
  adminNotes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export default function BtuCsgNewPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: prefillData } = useQuery<PrefillData>({
    queryKey: ["/api/sitespecific/btu/csg/prefill/current-user"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bpsId: "",
      firstName: "",
      lastName: "",
      phone: "",
      nonBpsEmail: "",
      school: "",
      principalHeadmaster: "",
      role: "",
      typeOfClass: "",
      course: "",
      section: "",
      numberOfStudents: "",
      comments: "",
      status: "pending",
      adminNotes: "",
    },
  });

  useEffect(() => {
    if (prefillData) {
      if (prefillData.firstName) form.setValue("firstName", prefillData.firstName);
      if (prefillData.lastName) form.setValue("lastName", prefillData.lastName);
      if (prefillData.phone) form.setValue("phone", prefillData.phone);
      if (prefillData.school) form.setValue("school", prefillData.school);
    }
  }, [prefillData, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest("POST", "/api/sitespecific/btu/csg", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sitespecific/btu/csg"] });
      toast({
        title: "Success",
        description: "Grievance record created successfully.",
      });
      navigate("/sitespecific/btu/csgs");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to create record.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    createMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/sitespecific/btu/csgs">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            New Class Size Grievance
          </h1>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
              <CardDescription>Information about the person filing the grievance</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="bpsId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>BPS ID</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-bps-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div />
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-first-name" />
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
                    <FormLabel>Last Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-last-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nonBpsEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Non-BPS Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>School Information</CardTitle>
              <CardDescription>Details about the school and class</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="school"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-school" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="principalHeadmaster"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Principal/Headmaster</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-principal" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What is your role?</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-role" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="typeOfClass"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type of Class</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-class-type" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="course"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Course</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-course" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="section"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-section" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="numberOfStudents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Number of Students</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-students" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Grievance Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="comments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comments</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={4} data-testid="input-comments" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="adminNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={4} data-testid="input-admin-notes" />
                    </FormControl>
                    <FormDescription>Internal notes (not visible to the submitter)</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Link href="/sitespecific/btu/csgs">
              <Button variant="outline" type="button" data-testid="button-cancel">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Grievance
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
