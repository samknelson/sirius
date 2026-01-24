import { useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, Mail, MessageSquare, Smartphone } from "lucide-react";
import type { JobTypeData, NotificationMedia } from "@shared/schema";

const NOTIFICATION_MEDIA_OPTIONS: { id: NotificationMedia; label: string; description: string; icon: typeof Mail }[] = [
  { id: 'email', label: 'Email', description: 'Send notifications via email', icon: Mail },
  { id: 'sms', label: 'SMS', description: 'Send notifications via text message', icon: Smartphone },
  { id: 'in-app', label: 'In-App', description: 'Show notifications within the application', icon: MessageSquare },
];

function DispatchJobTypeNotificationsContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();
  
  const jobTypeData = jobType.data as JobTypeData | undefined;
  const notificationMedia = jobTypeData?.notificationMedia || [];

  const saveNotificationsMutation = useMutation({
    mutationFn: async (newMedia: NotificationMedia[]) => {
      const updatedData: JobTypeData = {
        ...jobTypeData,
        notificationMedia: newMedia.length > 0 ? newMedia : undefined,
      };
      return apiRequest("PUT", `/api/options/dispatch-job-type/${jobType.id}`, {
        name: jobType.name,
        description: jobType.description,
        data: updatedData,
      });
    },
    onMutate: async (newMedia) => {
      await queryClient.cancelQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
      
      const previousJobType = queryClient.getQueryData(["/api/options/dispatch-job-type", jobType.id]);
      
      queryClient.setQueryData(["/api/options/dispatch-job-type", jobType.id], (old: typeof jobType | undefined) => {
        if (!old) return old;
        const oldData = (old.data || {}) as JobTypeData;
        return {
          ...old,
          data: {
            ...oldData,
            notificationMedia: newMedia.length > 0 ? newMedia : undefined,
          },
        };
      });
      
      return { previousJobType };
    },
    onError: (error: any, _newMedia, context) => {
      if (context?.previousJobType) {
        queryClient.setQueryData(["/api/options/dispatch-job-type", jobType.id], context.previousJobType);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to save notification settings.",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Notification settings updated.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options/dispatch-job-type", jobType.id] });
    },
  });

  const toggleMedia = (mediaId: NotificationMedia) => {
    let newMedia: NotificationMedia[];
    
    if (notificationMedia.includes(mediaId)) {
      newMedia = notificationMedia.filter(m => m !== mediaId);
    } else {
      newMedia = [...notificationMedia, mediaId];
    }
    
    saveNotificationsMutation.mutate(newMedia);
  };

  const isMediaSelected = (mediaId: NotificationMedia): boolean => {
    return notificationMedia.includes(mediaId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" data-testid="title-notifications">
          <Bell className="h-5 w-5" />
          Notification Media
        </CardTitle>
        <CardDescription>
          Configure which notification channels are used for jobs of this type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {NOTIFICATION_MEDIA_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isPending = saveNotificationsMutation.isPending;
          return (
            <div 
              key={option.id} 
              className={`flex items-center gap-4 p-4 border rounded-md ${isPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover-elevate'}`}
              onClick={() => !isPending && toggleMedia(option.id)}
              data-testid={`row-media-${option.id}`}
            >
              <Checkbox
                id={`media-${option.id}`}
                checked={isMediaSelected(option.id)}
                disabled={isPending}
                onClick={(e) => e.stopPropagation()}
                data-testid={`checkbox-media-${option.id}`}
              />
              <Icon className="h-5 w-5 text-muted-foreground" />
              <div className="space-y-1 flex-1">
                <Label htmlFor={`media-${option.id}`} className="font-medium cursor-pointer">
                  {option.label}
                </Label>
                <p className="text-sm text-muted-foreground">{option.description}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function DispatchJobTypeNotificationsPage() {
  usePageTitle("Job Type Notifications");
  return (
    <DispatchJobTypeLayout activeTab="notifications">
      <DispatchJobTypeNotificationsContent />
    </DispatchJobTypeLayout>
  );
}
