using System.Net;
using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class PrivateNetworkAddressGuardTests
{
    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("127.5.5.5")]
    [InlineData("10.0.0.1")]
    [InlineData("10.255.255.255")]
    [InlineData("172.16.0.1")]
    [InlineData("172.31.255.255")]
    [InlineData("192.168.0.1")]
    [InlineData("192.168.255.255")]
    [InlineData("169.254.0.1")]
    [InlineData("169.254.169.254")] // Azure/AWS/GCP metadata endpoint
    [InlineData("100.64.0.1")] // CGNAT
    [InlineData("0.0.0.0")]
    [InlineData("0.5.5.5")]
    [InlineData("192.0.0.1")]
    [InlineData("192.0.2.1")] // TEST-NET-1
    [InlineData("198.18.0.1")]
    [InlineData("198.51.100.1")] // TEST-NET-2
    [InlineData("203.0.113.1")] // TEST-NET-3
    [InlineData("224.0.0.1")] // multicast
    [InlineData("240.0.0.1")] // reserved
    [InlineData("255.255.255.255")] // broadcast
    public void IsPublicRoutable_BlocksNonRoutableIPv4(string ip)
    {
        Assert.False(PrivateNetworkAddressGuard.IsPublicRoutable(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("::1")] // loopback
    [InlineData("::")] // unspecified
    [InlineData("fe80::1")] // link-local
    [InlineData("fc00::1")] // unique local
    [InlineData("fd12:3456:789a::1")] // unique local
    [InlineData("ff02::1")] // multicast
    [InlineData("2001:db8::1")] // documentation
    [InlineData("::ffff:127.0.0.1")] // IPv4-mapped loopback
    [InlineData("::ffff:10.0.0.1")] // IPv4-mapped private
    public void IsPublicRoutable_BlocksNonRoutableIPv6(string ip)
    {
        Assert.False(PrivateNetworkAddressGuard.IsPublicRoutable(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("1.1.1.1")]
    [InlineData("93.184.216.34")]
    public void IsPublicRoutable_AllowsPublicIPv4(string ip)
    {
        Assert.True(PrivateNetworkAddressGuard.IsPublicRoutable(IPAddress.Parse(ip)));
    }

    [Theory]
    [InlineData("2606:4700:4700::1111")] // Cloudflare public DNS
    [InlineData("2001:4860:4860::8888")] // Google public DNS
    public void IsPublicRoutable_AllowsPublicIPv6(string ip)
    {
        Assert.True(PrivateNetworkAddressGuard.IsPublicRoutable(IPAddress.Parse(ip)));
    }
}
