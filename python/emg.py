import busio
import digitalio
import board
import adafruit_mcp3xxx.mcp3008 as MCP
from adafruit_mcp3xxx.analog_in import AnalogIn
 
# create the spi bus
spi = busio.SPI(clock=board.SCK, MISO=board.MISO, MOSI=board.MOSI)
 
# create the cs (chip select)
cs = digitalio.DigitalInOut(board.D5)
 
# create the mcp object
# Software SPI configuration:
CLK  = 18
MISO = 23
MOSI = 24
CS   = 25
mcp = MCP.MCP3008(clk=CLK, cs=CS, miso=MISO, mosi=MOSI)
mcp.read_adc(i)
 
# create an analog input channel on pin 0
chan = AnalogIn(mcp, MCP.P0)
 
import time
while True:
    print('Raw ADC Value: ', chan.value)
    #print('ADC Voltage: ' + str(chan.voltage) + 'V')
    time.sleep(0.5)