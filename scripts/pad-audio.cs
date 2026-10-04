using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace PadProAudio {
    [Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolumeCallback {
        [PreserveSig]
        int OnNotify(IntPtr pNotify);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
        [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
        [PreserveSig] int GetChannelCount(out uint pnChannelCount);
        [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
        [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
        [PreserveSig] int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
        [PreserveSig] int VolumeStepUp(ref Guid pguidEventContext);
        [PreserveSig] int VolumeStepDown(ref Guid pguidEventContext);
        [PreserveSig] int QueryHardwareSupport(out uint pdwHardwareSupportMask);
        [PreserveSig] int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        [PreserveSig] int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object aev);
    }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out object ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorComObject { }

    [StructLayout(LayoutKind.Sequential)]
    public struct AUDIO_VOLUME_NOTIFICATION_DATA {
        public Guid guidEventContext;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bMuted;
        public float fMasterVolume;
        public uint nChannels;
    }

    public class AudioCallback : IAudioEndpointVolumeCallback {
        public int OnNotify(IntPtr pNotify) {
            try {
                var data = (AUDIO_VOLUME_NOTIFICATION_DATA)Marshal.PtrToStructure(pNotify, typeof(AUDIO_VOLUME_NOTIFICATION_DATA));
                int pct = (int)Math.Round(data.fMasterVolume * 100);
                int mute = data.bMuted ? 1 : 0;
                Console.WriteLine("VOL:" + pct + "|MUTE:" + mute);
                Console.Out.Flush();
            } catch {}
            return 0;
        }
    }

    class Program {
        static IAudioEndpointVolume GetEndpoint() {
            var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
            IMMDevice dev = null;
            enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
            var IID = typeof(IAudioEndpointVolume).GUID;
            object epvObj = null;
            dev.Activate(ref IID, 23, IntPtr.Zero, out epvObj);
            return (IAudioEndpointVolume)epvObj;
        }

        static void Main(string[] args) {
            try {
                var epv = GetEndpoint();
                float curVol = 0;
                epv.GetMasterVolumeLevelScalar(out curVol);
                bool isMute = false;
                epv.GetMute(out isMute);
                int curPct = (int)Math.Round(curVol * 100);
                int curMuteInt = isMute ? 1 : 0;

                string mode = args.Length > 0 ? args[0].ToLower() : "get";

                if (mode == "get") {
                    Console.WriteLine("VOL:" + curPct + "|MUTE:" + curMuteInt);
                    return;
                }

                if (mode == "set" && args.Length > 1) {
                    float newVol = float.Parse(args[1]) / 100f;
                    Guid ctx = Guid.Empty;
                    epv.SetMasterVolumeLevelScalar(newVol, ref ctx);
                    Console.WriteLine("VOL:" + (int)Math.Round(newVol * 100));
                    return;
                }

                if (mode == "listen") {
                    var cb = new AudioCallback();
                    epv.RegisterControlChangeNotify(cb);
                    Console.WriteLine("READY|VOL:" + curPct + "|MUTE:" + curMuteInt);
                    Console.Out.Flush();

                    // Keep alive listening
                    while (true) {
                        Thread.Sleep(500);
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("ERROR:" + ex.Message);
            }
        }
    }
}
