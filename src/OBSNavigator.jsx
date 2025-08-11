import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import { Box, IconButton, Typography } from "@mui/material";
import { useContext } from "react";
import OBSContext from "../contexts/obsContext";
import { ButtonGroup } from '@mui/material';

function OBSNavigator({ max, title }) {

    const getTitle = (title) => {
        if (!title) { return ''}
        const regex = /^(\d+)\.\s/;
        title = title.trim();
        title = title.replace(regex, '');
        return title;
    }

    const { obs, setObs } = useContext(OBSContext);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <ButtonGroup>
                <IconButton disabled={obs[0] <= 1} onClick={() => setObs([obs[0] - 1 > 0 ? obs[0] - 1 : obs[0], 0])}>
                    <KeyboardDoubleArrowLeftIcon fontSize="medium" />
                </IconButton>
                <IconButton disabled={obs[1] <= 0} onClick={() => setObs([obs[0], obs[1] - 1 >= 0 ? obs[1] - 1 : obs[1]])}>
                    <KeyboardArrowLeftIcon fontSize="medium" />
                </IconButton>
                </ButtonGroup>

                <Box sx={{
                    border: '1px solid #DAE2ED',
                    borderRadius: '4px',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '1rem',
                    width: 221,
                    height: 40,
                    mx: 2,
                    px: 1,
                    gap: 1,
                }}>
                    <Typography
                        noWrap
                        sx={{
                            flex: '1 1 auto',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'rgba(0, 0, 0, 0.6)',
                            fontSize: '1rem'
                        }}
                    >
                        {`${obs[0]}. ${getTitle(title)}`}
                    </Typography>
                    <Typography sx={{ flex: '0 0 auto', color: 'rgba(0, 0, 0, 0.6)', bottom: 0, fontSize: '1rem' }}>{obs[1]}</Typography>
                </Box>

                <ButtonGroup>
                    <IconButton disabled={obs[1] >= max} onClick={() => setObs([obs[0], obs[1] + 1 <= max ? obs[1] + 1 : obs[1]])}>
                        <KeyboardArrowRightIcon fontSize="medium" />
                    </IconButton>
                    <IconButton disabled={obs[0] >= 50} onClick={() => setObs([obs[0] + 1 <= 50 ? obs[0] + 1 : obs[0], 0])}>
                        <KeyboardDoubleArrowRightIcon fontSize="medium" />
                    </IconButton>
                </ButtonGroup>
            </Box>
        </Box>
    )
}

export default OBSNavigator;