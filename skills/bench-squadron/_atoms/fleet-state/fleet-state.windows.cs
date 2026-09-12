using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class BenchWindowsJob
{
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long PerProcessUserTime, PerJobUserTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int info, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int info, out Accounting data, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    static void Check(bool condition) { if (!condition) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static uint Active(IntPtr job) {
        Accounting data;
        Check(QueryInformationJobObject(job, 1, out data, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        return data.ActiveProcesses;
    }
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            slashes = 0;
            result.Append(c);
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    static void Receipt(string file, string job, string stage, uint pid) {
        string json = "{\"job\":\"" + job.Replace("\\", "\\\\") + "\",\"stage\":\"" + stage + "\",\"pid\":" + pid + "}";
        File.WriteAllText(file, json, new UTF8Encoding(false));
    }
    static bool Drain(IntPtr job) {
        DateTime until = DateTime.UtcNow.AddSeconds(5);
        while (Active(job) != 0 && DateTime.UtcNow < until) Thread.Sleep(20);
        return Active(job) == 0;
    }

    public static int Inspect(string name) {
        IntPtr job = OpenJobObject(0x0004, false, name);
        if (job == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            if (error == 2) return -1;
            throw new Win32Exception(error);
        }
        try {
            return (int)Active(job);
        } finally { CloseHandle(job); }
    }

    public static int Run(string name, string executable, string[] args, string cwd,
        double deadlineMs, uint parentPid, string receipt, string cancelled) {
        IntPtr job = IntPtr.Zero, parent = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo();
        bool assigned = false, collision = false;
        try {
            DateTime deadline = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(deadlineMs);
            if (File.Exists(cancelled) || DateTime.UtcNow >= deadline) throw new InvalidOperationException("Launch cancelled or deadline exhausted");
            parent = OpenProcess(0x00100000, false, parentPid);
            Check(parent != IntPtr.Zero);
            job = CreateJobObject(IntPtr.Zero, name);
            int error = Marshal.GetLastWin32Error();
            Check(job != IntPtr.Zero);
            if (error == 183) {
                collision = true;
                CloseHandle(job); job = IntPtr.Zero;
                throw new InvalidOperationException("Job identity already exists; refusing adoption");
            }
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x00002000; // KILL_ON_JOB_CLOSE; neither breakaway flag is granted.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
            var start = new Startup();
            start.Size = (uint)Marshal.SizeOf(typeof(Startup));
            start.Flags = 0x00000100;
            start.Input = GetStdHandle(-10); start.Output = GetStdHandle(-11); start.Error = GetStdHandle(-12);
            foreach (IntPtr handle in new[] { start.Input, start.Output, start.Error })
                Check(SetHandleInformation(handle, 1, 1));
            var line = new StringBuilder(Quote(executable));
            foreach (string arg in args ?? new string[0]) line.Append(' ').Append(Quote(arg));
            if (File.Exists(cancelled) || DateTime.UtcNow >= deadline) throw new InvalidOperationException("Launch cancelled or deadline exhausted");
            // The target cannot execute or create descendants before job assignment.
            Check(CreateProcess(executable, line, IntPtr.Zero, IntPtr.Zero, true,
                0x00000004 | 0x08000000, IntPtr.Zero, cwd, ref start, out child));
            Check(AssignProcessToJobObject(job, child.Process));
            assigned = true;
            Receipt(receipt, name, "assigned", child.Pid);
            if (File.Exists(cancelled) || DateTime.UtcNow >= deadline) throw new InvalidOperationException("Launch cancelled or deadline exhausted");
            Check(ResumeThread(child.Thread) != 0xffffffff);
            bool timedOut = false;
            while (WaitForSingleObject(child.Process, 20) != 0) {
                if (WaitForSingleObject(parent, 0) == 0 || DateTime.UtcNow >= deadline || File.Exists(cancelled)) {
                    timedOut = true;
                    Check(TerminateJobObject(job, 124));
                    break;
                }
            }
            uint exitCode;
            Check(GetExitCodeProcess(child.Process, out exitCode));
            // A finished root does not prove its descendants finished.
            if (Active(job) != 0) Check(TerminateJobObject(job, 124));
            if (!Drain(job)) throw new InvalidOperationException("Job process release is uncertain");
            Receipt(receipt, name, "released", child.Pid);
            return timedOut ? 124 : unchecked((int)exitCode);
        } catch {
            bool released = true;
            if (child.Process != IntPtr.Zero && !assigned) {
                TerminateProcess(child.Process, 125);
                released = WaitForSingleObject(child.Process, 5000) == 0;
            }
            if (job != IntPtr.Zero) {
                TerminateJobObject(job, 125);
                try { released = Drain(job) && released; } catch { released = false; }
            }
            Receipt(receipt, name, collision ? "unowned" : released ? "failed-released" : "uncertain", child.Pid);
            throw;
        } finally {
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            if (parent != IntPtr.Zero) CloseHandle(parent);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
