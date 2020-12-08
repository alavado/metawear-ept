# Simple example of reading the MCP3008 analog input channels and printing
# them all out.
# Author: Tony DiCola
# License: Public Domain
import time

# Import SPI library (for hardware SPI) and MCP3008 library.
import Adafruit_GPIO.SPI as SPI
import Adafruit_MCP3008

# Software SPI configuration:
#CLK  = 23
#MISO = 21
#MOSI = 19
#CS   = 24
#mcp = Adafruit_MCP3008.MCP3008(clk=CLK, cs=CS, miso=MISO, mosi=MOSI)

# Hardware SPI configuration:
SPI_PORT   = 0
SPI_DEVICE = 0
mcp = Adafruit_MCP3008.MCP3008(spi=SPI.SpiDev(SPI_PORT, SPI_DEVICE))

#hora = time.time()
#freq = 1.0 / 1000

# Main program loop.
while True:
 #   if (time.time() - hora > freq)
 #       continue
 #   hora = time.time()
    # Read all the ADC channel values in a list.
    values = [0] * 4
    for i in range(len(values)):
        values[i] = str(mcp.read_adc(i))

    print(','.join(values + [str(time.time())]))

