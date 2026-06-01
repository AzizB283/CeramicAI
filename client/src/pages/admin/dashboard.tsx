import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Sparkles,
  PhoneCall,
  CheckCircle2,
  Globe2,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

interface AdminStats {
  total: number;
  byStatus: { new: number; contacted: number; converted: number; lost: number };
  byPriority: { normal: number; high: number; priority: number };
  distributorInquiries: number;
  priorityWaiting: number;
  recent: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: "#e85d04",
  contacted: "#fb8b24",
  converted: "#16a34a",
  lost: "#9ca3af",
};

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your ceramic leads</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const total = stats?.total ?? 0;

  if (total === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your ceramic leads</p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-coral/10">
              <Users className="h-7 w-7 text-coral" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">No leads yet</h3>
            <p className="mx-auto mb-6 max-w-sm text-sm text-muted-foreground">
              Once buyers start chatting with CeramicBot, captured inquiries will
              show up here. Try the chat to generate a demo lead.
            </p>
            <Link href="/admin/chat-widget">
              <Button>Open chat preview</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cards = [
    {
      title: "Total Leads",
      value: total,
      icon: Users,
      hint: "All inquiries captured",
    },
    {
      title: "New",
      value: stats?.byStatus.new ?? 0,
      icon: Sparkles,
      hint: "Awaiting first contact",
    },
    {
      title: "Contacted",
      value: stats?.byStatus.contacted ?? 0,
      icon: PhoneCall,
      hint: "Follow-up in progress",
    },
    {
      title: "Converted",
      value: stats?.byStatus.converted ?? 0,
      icon: CheckCircle2,
      hint: "Won deals",
    },
    {
      title: "Distributor Inquiries",
      value: stats?.distributorInquiries ?? 0,
      icon: Globe2,
      hint: "Priority partner leads",
    },
    {
      title: "Last 7 Days",
      value: stats?.recent ?? 0,
      icon: CalendarClock,
      hint: "Recent activity",
    },
  ];

  const chartData = [
    { name: "New", value: stats?.byStatus.new ?? 0, key: "new" },
    { name: "Contacted", value: stats?.byStatus.contacted ?? 0, key: "contacted" },
    { name: "Converted", value: stats?.byStatus.converted ?? 0, key: "converted" },
    { name: "Lost", value: stats?.byStatus.lost ?? 0, key: "lost" },
  ];

  const priorityWaiting = stats?.priorityWaiting ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your ceramic leads</p>
      </div>

      {priorityWaiting > 0 && (
        <Link href="/admin/leads">
          <Card className="cursor-pointer border-red-300 bg-red-50 transition hover:border-red-400 hover:bg-red-100">
            <CardContent className="flex items-center gap-4 py-5">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-red-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold text-red-700">
                  {priorityWaiting} priority lead{priorityWaiting === 1 ? "" : "s"} waiting
                </div>
                <p className="text-sm text-red-700/80">
                  Distributor / exclusive-rights inquiries that haven't been converted or lost yet.
                  Click to view.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
              <c.icon className="h-4 w-4 text-coral" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
              <p className="text-xs text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leads by Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  cursor={{ fill: "rgba(232,93,4,0.08)" }}
                  contentStyle={{ borderRadius: 12, fontSize: 12 }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={STATUS_COLORS[entry.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
